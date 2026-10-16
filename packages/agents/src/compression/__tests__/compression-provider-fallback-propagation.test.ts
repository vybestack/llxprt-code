/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for CompressionHandler provider fallback failure
 * propagation and stage-aware projection errors (Issue #2588 findings).
 *
 * Finding 1: When the real provider fallback path (top-down truncation or
 * buildCompressionContext) fails during hard-limit enforcement, the failure
 * cause must propagate to the final overflow diagnostics. Previously the
 * error was swallowed at two layers (the createProviderContentEnforcer lambda
 * catches and returns false; CompressionHandler.performFallbackCompression
 * also catches and returns false), so truncationFailure was never set and the
 * final overflow error lost the cause.
 *
 * Finding 2: When estimateTokensForContents rejects after compression, retry,
 * or truncation mutations, the error must include stage/action context so the
 * caller can diagnose which stage failed. Previously the raw projection error
 * bubbled up ambiguously.
 *
 * These tests follow dev-docs/RULES.md: they assert observable behavior
 * (error messages, content preservation) and NEVER assert that mock functions
 * were called with specific arguments.
 */

import { installFixtureCandidate } from './provider-fallback-candidate-fixture.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  makeUserMessage,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';
import { buildHandlerHarness } from './support/handler-harness.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { type CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  makeStoredAi,
  makeCompressionSnapshot,
  estimateBookkeepingProjection,
  seedFallbackCooldown,
  installProviderDiskFixture,
} from './compression-provider-fallback-test-helpers.js';

const original = { ...(await import('@vybestack/llxprt-code-settings')) };
void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...original,
  Storage: new Proxy(original.Storage, {
    get(target, property, receiver) {
      return property === 'getGlobalConfigDir'
        ? vi.fn(() => '/tmp/llxprt-test-config')
        : Reflect.get(target, property, receiver);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Finding 1: Provider fallback failure propagation through real wiring
// ---------------------------------------------------------------------------

let suite0HistoryService: HistoryService;

let suite0RuntimeContext: AgentRuntimeContext;

let suite0Handler: CompressionHandler;

let suite1HistoryService: HistoryService;

interface LadderHarness {
  handler: CompressionHandler;
  setDiskFallback: ReturnType<typeof buildHandlerHarness>['setDiskFallback'];
  performCompression: ReturnType<
    typeof buildHandlerHarness
  >['performCompression'];
}

/** Makes the handler's prompt-baseline reset fail the way a throwing setter would. */
function failBaselineReset(handler: CompressionHandler, message: string): void {
  let baseline = handler.getLastPromptTokenCount();
  Object.defineProperty(handler, 'lastPromptTokenCount', {
    configurable: true,
    get: () => baseline,
    set: (value: number | null) => {
      if (value === null) throw new Error(message);
      baseline = value;
    },
  });
}

function suite1BuildHarness(): LadderHarness {
  const runtimeContext = buildRuntimeContext(suite1HistoryService, {
    contextLimit: 200_000,
    compressionThreshold: 0.8,
  });
  return buildHandlerHarness(suite1HistoryService, runtimeContext);
}

function enforceSuite1(
  harness: LadderHarness,
  pending: IContent[],
  promptId: string,
  estimateRows?: (rows: IContent[]) => Promise<number>,
  pendingRecoverable = true,
): Promise<IContent[]> {
  return enforceProviderSourceForTest(
    harness.handler,
    suite1HistoryService,
    pending,
    promptId,
    undefined,
    estimateRows,
    pendingRecoverable,
  );
}

describe('Finding 1: provider fallback failure propagation through real CompressionHandler (Issue #2588)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suite0HistoryService = new HistoryService();
    suite0RuntimeContext = buildRuntimeContext(suite0HistoryService, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
      compressionStrategy: 'high-density',
    });

    const provider = {
      name: 'test',
      generateChatCompletion: vi.fn(),
    } as unknown as RuntimeProvider;
    const providerResult: CompressionProviderResult = { provider };
    suite0Handler = new CompressionHandler(
      suite0RuntimeContext,
      suite0HistoryService,
      {},
      vi.fn().mockResolvedValue(providerResult),
      vi.fn().mockResolvedValue(undefined),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * When the top-down-truncation fallback strategy throws during
   * provider-source hard-limit enforcement, the error must propagate
   * as truncationFailure in the final overflow diagnostics.
   */
  it(
    'propagates fallback truncation failure cause into the final overflow error',
    testBody0,
  );

  /**
   * When buildCompressionContext fails during the provider fallback path,
   * the error must also propagate as truncationFailure.
   */
  it(
    'propagates buildCompressionContext failure cause into the final overflow error',
    testBody1,
  );

  /**
   * When the fallback strategy succeeds, the normal happy path should work.
   *
   * Compression is simulated at the handler boundary. Scripted projections
   * keep the initial, post-density, and post-first-compression payloads over
   * limit while making the simulated first compression effective enough to
   * bypass retry. Only the post-truncation projection fits, proving that the
   * real handler-to-fallback wiring applied the strategy result instead of
   * returning early from an earlier stage. The returned contents must
   * contain the truncated summary and preserve the pending message.
   */
  it('still succeeds when fallback truncation works correctly', testBody2);

  it(
    'keeps pending fallback failure bookkeeping when candidate commit rejects',
    testBody3,
  );

  it(
    'keeps provider fallback failure bookkeeping when candidate commit rejects',
    testBody4,
  );

  it(
    'publishes pending fallback success bookkeeping after candidate commit',
    testBody5,
  );

  it(
    'publishes provider fallback success bookkeeping after candidate commit',
    testBody6,
  );
});

// ---------------------------------------------------------------------------
// Finding 2: Stage-aware projection errors in the source ladder
// ---------------------------------------------------------------------------

describe('Finding 2: stage-aware projection errors in the CompressionHandler source ladder (Issue #2588)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suite1HistoryService = new HistoryService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'preserves all history state when fallback candidate installation fails',
    testBody7,
  );

  it(
    'restores history state when fallback rejects after committing its candidate',
    testBody8,
  );

  it(
    'restores history state when prompt-baseline reset fails after replacement',
    testBody9,
  );

  /**
   * Post-first-compression projection failure.
   *
   * enforce() projection call sequence:
   * 1. Initial projection (enforce)
   * 2. Post-density-optimization (optimizeAndProject)
   * 3. Post-compression (projectSuccess) — ALL subsequent calls reject
   */
  it(
    'includes stage context when projection fails after first compression',
    testBody10,
  );

  /**
   * Post-retry projection failure.
   *
   * enforce() projection call sequence:
   * 1. Initial projection
   * 2. Post-density-optimization
   * 3. Post-first-compression (reduction < 5%, triggers retry)
   * 4. Post-retry-compression — ALL subsequent calls reject
   */
  it(
    'includes stage context when projection fails after retry compression',
    testBody11,
  );

  /**
   * Post-truncation projection failure.
   *
   * enforce() projection call sequence:
   * 1. Initial projection
   * 2. Post-density-optimization
   * 3. Post-first-compression (reduction < 5%, triggers retry)
   * 4. Post-retry-compression (still over, triggers truncation)
   * 5. Post-truncation — ALL subsequent calls reject
   */
  it(
    'includes stage context when projection fails after truncation',
    testBody12,
  );

  /**
   * Initial projection failure should propagate with a stage label.
   */
  it(
    'propagates initial projection error with explicit stage label',
    testBody13,
  );

  /**
   * Finding 4 (CodeRabbit PR #2598): Projection rejection must not be caught
   * as a compression failure.
   *
   * When the first post-compression projection rejects, the stage-aware
   * projection error must propagate directly — not be caught by the
   * compression try/catch and re-projected as a compression failure. If the
   * second estimate would succeed, enforcement must NOT proceed to truncation
   * or fallback; it must surface the original projection error.
   */
  it(
    'throws the stage-aware projection error when post-compression projection rejects, even if a subsequent estimate would succeed (CodeRabbit PR #2598)',
    testBody14,
  );
});

async function testBody0(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));
  suite0HistoryService.add(makeStoredAi('resp-preserved-on-failure'));

  const pending = makeUserMessage('pending request');
  vi.spyOn(suite0HistoryService, 'estimateTokensForContents').mockResolvedValue(
    150_000,
  );

  vi.spyOn(suite0Handler, 'performCompression').mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  vi.spyOn(
    TopDownTruncationStrategy.prototype,
    'compressDisk',
  ).mockRejectedValue(new Error('truncation engine blew up'));

  let thrownError: Error | undefined;
  try {
    await enforceProviderSourceForTest(
      suite0Handler,
      suite0HistoryService,
      [pending],
      'test-prompt',
      undefined,
    );
  } catch (error) {
    thrownError = error as Error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain(
    'Truncation fallback failed during hard-limit enforcement',
  );
  expect(thrownError!.message).toContain('truncation engine blew up');
  expect(
    (await collectRawHistory(suite0HistoryService))[1].metadata
      ?.responsesStored,
  ).toBe(true);
  expect((await collectRawHistory(suite0HistoryService))[1].metadata?.id).toBe(
    'resp-preserved-on-failure',
  );
}

async function testBody1(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));

  const pending = makeUserMessage('pending request');
  vi.spyOn(suite0HistoryService, 'estimateTokensForContents').mockResolvedValue(
    150_000,
  );

  vi.spyOn(suite0Handler, 'performCompression').mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  suite0Handler.setTranscriptPathProvider(() => {
    throw new Error('context build exploded');
  });

  let thrownError: Error | undefined;
  try {
    await enforceProviderSourceForTest(
      suite0Handler,
      suite0HistoryService,
      [pending],
      'test-prompt',
      undefined,
    );
  } catch (error) {
    thrownError = error as Error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain(
    'Truncation fallback failed during hard-limit enforcement',
  );
  expect(thrownError?.message).toContain('context build exploded');
}

async function testBody2(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));

  const pending = makeUserMessage('pending request');
  // contextLimit = 200_000, completionBudget = 65_536
  // marginAdjustedLimit = 199_995 → over-limit when projected > 199_995
  // estimate + 65_536 > 199_995 → estimate > 134_459
  const OVER_LIMIT_ESTIMATE = 150_000; // 150_000 + 65_536 = 215_536 > 199_995
  const TRUNCATED_SUMMARY_ESTIMATE = 50_000; // 50_000 + 65_536 = 115_536 < 199_995

  const estimateSpy = vi.spyOn(
    suite0HistoryService,
    'estimateTokensForContents',
  );
  // 1. Initial projection — over-limit
  estimateSpy.mockResolvedValueOnce(OVER_LIMIT_ESTIMATE);
  // 2. Post-density-optimization — over-limit
  estimateSpy.mockResolvedValueOnce(OVER_LIMIT_ESTIMATE);
  // 3. Post-first-compression — still over-limit, but effective enough to
  //    avoid retry (reduction >= 5% of pre-compression projection).
  //    pre-compression projected = 215_536, need reduction >= ~10_777,
  //    so post-compression estimate <= 139_223 keeps ratio >= 5%.
  //    135_000 + 65_536 = 200_536 > 199_995 (still over margin limit).
  estimateSpy.mockResolvedValueOnce(135_000);
  // 4. Post-truncation — under-limit (fallback succeeded)
  estimateSpy.mockResolvedValueOnce(TRUNCATED_SUMMARY_ESTIMATE);

  vi.spyOn(suite0Handler, 'performCompression').mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  const fallbackHistory = [
    makeStoredAi('resp-fallback-1'),
    makeUserMessage('truncated summary'),
    makeStoredAi('resp-fallback-2'),
  ];
  installProviderDiskFixture(fallbackHistory);
  suite0Handler.setLastPromptTokenCount(123);

  let incrementalPublications = 0;
  suite0HistoryService.on('contentAdded', () => {
    incrementalPublications += 1;
  });

  const result = await enforceProviderSourceForTest(
    suite0Handler,
    suite0HistoryService,
    [pending],
    'test-prompt',
    undefined,
  );

  // The truncated summary content must appear in the returned provider
  // contents, proving the fallback path applied its result.
  const resultText = result
    .flatMap((c) => c.blocks)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join(' ');
  expect(resultText).toContain('truncated summary');

  // The pending request must be preserved in the returned contents.
  expect(result).toContainEqual(pending);

  const rewrittenHistory = await collectRawHistory(suite0HistoryService);
  expect(rewrittenHistory[0].metadata).toMatchObject({
    id: 'resp-fallback-1',
    providerBaseURL: 'https://api.openai.com/v1',
    providerMetadata: { custom: 'metadata resp-fallback-1' },
  });
  expect(rewrittenHistory[0].metadata?.responsesStored).toBeUndefined();
  expect(rewrittenHistory[2].metadata).toMatchObject({
    id: 'resp-fallback-2',
    providerBaseURL: 'https://api.openai.com/v1',
    providerMetadata: { custom: 'metadata resp-fallback-2' },
  });
  expect(rewrittenHistory[2].metadata?.responsesStored).toBeUndefined();
  expect(suite0Handler.getLastPromptTokenCount()).toBe(0);
  expect(incrementalPublications).toBe(0);
}

async function testBody3(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));
  await suite0HistoryService.waitForTokenUpdates();
  const snapshot = makeCompressionSnapshot(
    'pending rejected committed snapshot',
  );
  const control = await seedFallbackCooldown(suite0Handler, [snapshot]);
  expect(suite0Handler['compressionFailureCount']).toBe(3);
  control.activateCandidateAfter(2);
  suite0Handler.setLastPromptTokenCount(150_000);
  vi.spyOn(suite0HistoryService.detachedValues, 'transform').mockRejectedValue(
    new Error('pending candidate commit rejected'),
  );

  await expect(
    suite0Handler.enforceContextWindow(0, 'pending-rejected-commit'),
  ).rejects.toThrow(/context limit/i);

  expect(suite0Handler['compressionFailureCount']).toBe(4);
  expect(suite0Handler['compressionSummary']).toBeUndefined();
  expect(suite0Handler['lastSuccessfulCompressionTime']).toBeNull();
  expect(suite0Handler.isCompressionInCooldown()).toBe(true);
  expect(suite0Handler.wasRecentlyCompressed()).toBe(false);
}

async function testBody4(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));
  await suite0HistoryService.waitForTokenUpdates();
  const snapshot = makeCompressionSnapshot(
    'provider rejected committed snapshot',
  );
  const control = await seedFallbackCooldown(suite0Handler, [snapshot]);
  expect(suite0Handler['compressionFailureCount']).toBe(3);
  control.activateCandidateAfter(1);
  vi.spyOn(suite0HistoryService.detachedValues, 'transform').mockRejectedValue(
    new Error('provider candidate commit rejected'),
  );
  const pending = makeUserMessage('pending request');

  await expect(
    enforceProviderSourceForTest(
      suite0Handler,
      suite0HistoryService,
      [pending],
      'provider-rejected-commit',
      undefined,
      estimateBookkeepingProjection,
    ),
  ).rejects.toThrow(/context limit/i);

  expect(suite0Handler['compressionFailureCount']).toBe(4);
  expect(suite0Handler['compressionSummary']).toBeUndefined();
  expect(suite0Handler['lastSuccessfulCompressionTime']).toBeNull();
  expect(suite0Handler.isCompressionInCooldown()).toBe(true);
  expect(suite0Handler.wasRecentlyCompressed()).toBe(false);
}

async function testBody5(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));
  await suite0HistoryService.waitForTokenUpdates();
  const snapshot = makeCompressionSnapshot(
    'pending successful committed snapshot',
  );
  const control = await seedFallbackCooldown(suite0Handler, [snapshot]);
  expect(suite0Handler['compressionFailureCount']).toBe(3);
  control.activateCandidateAfter(2);
  suite0Handler.setLastPromptTokenCount(150_000);

  await suite0Handler.enforceContextWindow(0, 'pending-successful-commit');

  expect(suite0Handler['compressionFailureCount']).toBe(0);
  expect(suite0Handler['compressionSummary']).toBe(snapshot);
  expect(suite0Handler['lastSuccessfulCompressionTime']).not.toBeNull();
  expect(suite0Handler.isCompressionInCooldown()).toBe(false);
  expect(suite0Handler.wasRecentlyCompressed()).toBe(true);
  expect(await collectRawHistory(suite0HistoryService)).toHaveLength(1);
  expect(
    (await collectRawHistory(suite0HistoryService))[0].blocks[0],
  ).toMatchObject({
    type: 'text',
    text: 'pending successful committed snapshot',
  });
}

async function testBody6(): Promise<void> {
  suite0HistoryService.add(makeUserMessage('established history'));
  await suite0HistoryService.waitForTokenUpdates();
  const snapshot = makeCompressionSnapshot(
    'provider successful committed snapshot',
  );
  const control = await seedFallbackCooldown(suite0Handler, [snapshot]);
  expect(suite0Handler['compressionFailureCount']).toBe(3);
  control.activateCandidateAfter(1);
  const pending = makeUserMessage('pending request');

  const contents = await enforceProviderSourceForTest(
    suite0Handler,
    suite0HistoryService,
    [pending],
    'provider-successful-commit',
    undefined,
    estimateBookkeepingProjection,
  );

  expect(suite0Handler['compressionFailureCount']).toBe(0);
  expect(suite0Handler['compressionSummary']).toBe(snapshot);
  expect(suite0Handler['lastSuccessfulCompressionTime']).not.toBeNull();
  expect(suite0Handler.isCompressionInCooldown()).toBe(false);
  expect(suite0Handler.wasRecentlyCompressed()).toBe(true);
  expect(contents).toContainEqual(snapshot);
  expect(contents).toContainEqual(pending);
}

async function testBody7(): Promise<void> {
  suite1HistoryService.add(makeStoredAi('resp-original-parent'));
  suite1HistoryService.add(makeUserMessage('original follow-up'));
  await suite1HistoryService.waitForTokenUpdates();
  suite1HistoryService.setBaseTokenOffset(37);
  const [anchorEntry] = await Array.fromAsync(
    suite1HistoryService.getChronologyTrace(),
  );
  suite1HistoryService.setCacheAnchorSeq(anchorEntry.seq);
  const originalHistory = [...(await collectRawHistory(suite1HistoryService))];
  const originalHistoryTokens =
    await suite1HistoryService.estimateTokensForContents(originalHistory);
  const harness = suite1BuildHarness();
  harness.handler.setLastPromptTokenCount(123);
  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );
  harness.setDiskFallback(async (_promptId, applyResult) => {
    await installFixtureCandidate(applyResult, [
      makeStoredAi('resp-candidate'),
    ]);
    return true;
  });
  suite1HistoryService.on('tokensUpdated', () => {
    throw new Error('injected candidate installation failure');
  });
  const pending = makeUserMessage('pending request');

  await expect(
    enforceSuite1(harness, [pending], 'failed-candidate', async () => 150_000),
  ).rejects.toThrow('injected candidate installation failure');

  expect(await collectRawHistory(suite1HistoryService)).toStrictEqual(
    originalHistory,
  );
  expect(suite1HistoryService.getTotalTokens()).toBe(
    originalHistoryTokens + 37,
  );
  expect(suite1HistoryService.getBaseTokenOffset()).toBe(37);
  expect(suite1HistoryService.getCacheAnchorSeq()).toBe(anchorEntry.seq);
  expect(harness.handler.getLastPromptTokenCount()).toBe(123);
  expect(
    (await collectRawHistory(suite1HistoryService))[0].metadata,
  ).toMatchObject({
    id: 'resp-original-parent',
    responsesStored: true,
    providerMetadata: { custom: 'metadata resp-original-parent' },
  });
}

async function testBody8(): Promise<void> {
  suite1HistoryService.add(makeStoredAi('resp-original-parent'));
  suite1HistoryService.add(makeUserMessage('original follow-up'));
  await suite1HistoryService.waitForTokenUpdates();
  suite1HistoryService.setBaseTokenOffset(37);
  const [anchorEntry] = await Array.fromAsync(
    suite1HistoryService.getChronologyTrace(),
  );
  suite1HistoryService.setCacheAnchorSeq(anchorEntry.seq);
  const originalHistory = [...(await collectRawHistory(suite1HistoryService))];
  const originalTokens =
    (await suite1HistoryService.estimateTokensForContents(originalHistory)) +
    37;
  const harness = suite1BuildHarness();
  harness.handler.setLastPromptTokenCount(123);
  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );
  harness.setDiskFallback(async (_promptId, applyResult) => {
    await installFixtureCandidate(applyResult, [
      makeStoredAi('resp-candidate'),
    ]);
    throw new Error('fallback bookkeeping failed');
  });
  const pending = makeUserMessage('pending request');

  await expect(
    enforceSuite1(
      harness,
      [pending],
      'rejected-after-commit',
      async () => 150_000,
    ),
  ).rejects.toThrow('fallback bookkeeping failed');

  expect(await collectRawHistory(suite1HistoryService)).toStrictEqual(
    originalHistory,
  );
  expect(suite1HistoryService.getTotalTokens()).toBe(originalTokens);
  expect(suite1HistoryService.getBaseTokenOffset()).toBe(37);
  expect(suite1HistoryService.getCacheAnchorSeq()).toBe(anchorEntry.seq);
  expect(harness.handler.getLastPromptTokenCount()).toBe(123);
}

async function testBody9(): Promise<void> {
  suite1HistoryService.add(makeStoredAi('resp-original-parent'));
  suite1HistoryService.add(makeUserMessage('original follow-up'));
  await suite1HistoryService.waitForTokenUpdates();
  suite1HistoryService.setBaseTokenOffset(37);
  const [anchorEntry] = await Array.fromAsync(
    suite1HistoryService.getChronologyTrace(),
  );
  suite1HistoryService.setCacheAnchorSeq(anchorEntry.seq);
  const originalHistory = [...(await collectRawHistory(suite1HistoryService))];
  const originalTokens =
    (await suite1HistoryService.estimateTokensForContents(originalHistory)) +
    37;
  const harness = suite1BuildHarness();
  harness.handler.setLastPromptTokenCount(123);
  failBaselineReset(harness.handler, 'prompt baseline reset failed');
  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );
  harness.setDiskFallback(async (_promptId, applyResult) => {
    await installFixtureCandidate(applyResult, [
      makeStoredAi('resp-candidate'),
    ]);
    return true;
  });
  const pending = makeUserMessage('pending request');

  await expect(
    enforceSuite1(
      harness,
      [pending],
      'failed-baseline-reset',
      async () => 150_000,
    ),
  ).rejects.toThrow('prompt baseline reset failed');

  expect(await collectRawHistory(suite1HistoryService)).toStrictEqual(
    originalHistory,
  );
  expect(suite1HistoryService.getTotalTokens()).toBe(originalTokens);
  expect(suite1HistoryService.getBaseTokenOffset()).toBe(37);
  expect(suite1HistoryService.getCacheAnchorSeq()).toBe(anchorEntry.seq);
  expect(harness.handler.getLastPromptTokenCount()).toBe(123);
}

async function testBody10(): Promise<void> {
  suite1HistoryService.add(makeUserMessage('established history'));
  const pending = makeUserMessage('pending request');
  const harness = suite1BuildHarness();
  const estimateSpy = vi.spyOn(
    suite1HistoryService,
    'estimateTokensForContents',
  );

  estimateSpy
    .mockResolvedValueOnce(200_000)
    .mockResolvedValueOnce(200_000)
    .mockRejectedValue(new Error('estimation infrastructure down'));

  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  let thrownError: Error | undefined;
  try {
    await enforceSuite1(harness, [pending], 'test-prompt');
  } catch (error) {
    thrownError = error as Error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain('estimation infrastructure down');
  expect(thrownError?.message).toContain('post-compression stage');
}

async function testBody11(): Promise<void> {
  suite1HistoryService.add(makeUserMessage('established history'));
  const pending = makeUserMessage('pending request');
  const harness = suite1BuildHarness();
  const estimateSpy = vi.spyOn(
    suite1HistoryService,
    'estimateTokensForContents',
  );

  estimateSpy
    .mockResolvedValueOnce(200_000)
    .mockResolvedValueOnce(200_000)
    .mockResolvedValueOnce(199_000)
    .mockRejectedValue(new Error('estimation infrastructure down'));

  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  let thrownError: Error | undefined;
  try {
    await enforceSuite1(harness, [pending], 'test-prompt');
  } catch (error) {
    thrownError = error as Error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain('estimation infrastructure down');
  expect(thrownError?.message.toLowerCase()).toContain('retry');
}

async function testBody12(): Promise<void> {
  suite1HistoryService.add(makeUserMessage('established history'));
  const pending = makeUserMessage('pending request');
  const harness = suite1BuildHarness();
  const estimateSpy = vi.spyOn(
    suite1HistoryService,
    'estimateTokensForContents',
  );

  estimateSpy
    .mockResolvedValueOnce(200_000)
    .mockResolvedValueOnce(200_000)
    .mockResolvedValueOnce(199_000)
    .mockResolvedValueOnce(199_000)
    .mockRejectedValue(new Error('estimation infrastructure down'));

  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  harness.setDiskFallback(async (_promptId, applyResult) => {
    await installFixtureCandidate(applyResult, [
      makeUserMessage('truncated history'),
    ]);
    return true;
  });

  let thrownError: Error | undefined;
  try {
    await enforceSuite1(harness, [pending], 'test-prompt');
  } catch (error) {
    thrownError = error as Error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain('estimation infrastructure down');
  expect(thrownError?.message.toLowerCase()).toContain('truncation');
}

async function testBody13(): Promise<void> {
  suite1HistoryService.add(makeUserMessage('established history'));
  const harness = suite1BuildHarness();
  vi.spyOn(suite1HistoryService, 'estimateTokensForContents').mockRejectedValue(
    new Error('estimation infrastructure down'),
  );

  let thrownError: Error | undefined;
  try {
    await enforceSuite1(harness, [], 'test-prompt', undefined, false);
  } catch (error) {
    thrownError = error as Error;
  }

  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain('estimation infrastructure down');
  expect(thrownError?.message.toLowerCase()).toContain('projection');
}

async function testBody14(): Promise<void> {
  suite1HistoryService.add(makeUserMessage('established history'));
  const pending = makeUserMessage('pending request');
  const harness = suite1BuildHarness();
  const estimateSpy = vi.spyOn(
    suite1HistoryService,
    'estimateTokensForContents',
  );

  // 1. Initial — over-limit (succeeds)
  estimateSpy.mockResolvedValueOnce(200_000);
  // 2. Post-density — over-limit (succeeds)
  estimateSpy.mockResolvedValueOnce(200_000);
  // 3. Post-first-compression — REJECTS with a specific stage error
  estimateSpy.mockRejectedValueOnce(
    new Error('estimation infrastructure down'),
  );
  // 4+. Any subsequent call would succeed (never reached)
  estimateSpy.mockResolvedValueOnce(50_000);

  let fallbackReached = false;
  harness.setDiskFallback(async () => {
    fallbackReached = true;
    return false;
  });
  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  let thrownError: Error | undefined;
  try {
    await enforceSuite1(harness, [pending], 'test-prompt');
  } catch (error) {
    thrownError = error as Error;
  }

  // The original stage-aware projection error must propagate directly.
  expect(thrownError).toBeInstanceOf(Error);
  expect(thrownError?.message).toContain('estimation infrastructure down');
  expect(thrownError?.message.toLowerCase()).toContain('post-compression');

  // Fallback must NOT be reached — the projection error surfaced before
  // truncation.
  expect(fallbackReached).toBe(false);
}
