/// <reference lib="esnext.array" />
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compression characterization tests — pins the OBSERVABLE behavior of
 * provider-content enforcement and compression budgeting BEFORE the
 * remaining retype group migrates `GenerateContentConfig`/`Part`-shaped
 * internals to neutral types.
 *
 * Uses REAL HistoryService, REAL ConversationManager, and the REAL
 * ProviderContentEnforcer / compressionBudgeting helpers. Mocks ONLY the
 * provider boundary where a provider would normally be consulted.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P26
 * @requirement:REQ-005.5c
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import * as fc from 'fast-check';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';

import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

import {
  asNumber,
  extractCompletionBudgetFromParams,
  getCompletionBudget,
  estimatePendingTokens,
  InvalidContextBudgetError,
} from '../compressionBudgeting.js';

import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { prepareAtSendSeam } from '../../core/promptEnvelopeSendSeam.js';
import { ContextOverflowError } from '../contextOverflowError.js';

// ---------------------------------------------------------------------------
// REQ-005.5c — providerContentEnforcement observable behavior
// ---------------------------------------------------------------------------

describe('P26: providerContentEnforcement characterization', () => {
  beforeEach(facadeCallback0);

  it(
    'returns the original contents unchanged when projected tokens are under the compression threshold',
    facadeCallback1,
  );

  it(
    'uses the finalized prompt-envelope estimate for first-turn compression decisions',
    facadeCallback2,
  );

  it(
    'uses the stateful Responses effective estimate and reprojects recomposed history before send',
    facadeCallback3,
  );

  it(
    'preserves structured overflow metadata when real stateful reprojection remains over limit',
    facadeCallback4,
  );

  it(
    'triggers compression when projected tokens exceed the compression threshold',
    facadeCallback5,
  );

  it(
    'returns recomposed pending contents after compression brings the projection under the limit',
    facadeCallback6,
  );

  it(
    'throws a context-overflow error when compression + fallback cannot bring the projection under the hard limit',
    facadeCallback7,
  );

  it(
    'throws an unrecoverable-boundary error when pendingContents is undefined and the projection is over the hard limit',
    facadeCallback8,
  );

  it(
    'returns original contents when pendingContents is undefined but the projection is under the hard limit',
    facadeCallback9,
  );

  // PROPERTY: for ANY token estimate under the compression threshold, the
  // original contents are returned untouched and compression never fires.
  it(
    'never compresses when the projected token estimate is under the threshold (property)',
    facadeCallback10,
  );
});
const observeGetCompletionBudgetPrefersTheLiveSettingsServiceMaxOutputTokensOverAllOtherSources =
  () => {
    const settingsService = {
      get: (key: string) => (key === 'maxOutputTokens' ? 32768 : undefined),
    };
    const cfg = { maxOutputTokens: 8192 } as Record<string, unknown>;

    return { cfg, settingsService };
  };
const observeGetCompletionBudgetRejectsALiveBudgetThatConsumesTheContext =
  () => {
    const settingsService = {
      get: (key: string) => (key === 'maxOutputTokens' ? 131_072 : undefined),
    };

    return { settingsService };
  };

// ---------------------------------------------------------------------------
// REQ-005.5c — compressionBudgeting observable behavior
// ---------------------------------------------------------------------------

describe('P26: compressionBudgeting characterization', () => {
  it(
    'asNumber extracts a finite number from a numeric value',
    facadeCallback11,
  );

  it('asNumber extracts a number from a numeric string', facadeCallback12);

  it('asNumber returns undefined for non-numeric input', facadeCallback13);

  it(
    'extractCompletionBudgetFromParams reads maxOutputTokens',
    facadeCallback14,
  );

  it(
    'extractCompletionBudgetFromParams reads maxTokens as a fallback',
    facadeCallback15,
  );

  it(
    'extractCompletionBudgetFromParams reads snake_case keys',
    facadeCallback16,
  );

  it(
    'extractCompletionBudgetFromParams returns undefined when no candidate key is present',
    facadeCallback17,
  );

  it(
    'getCompletionBudget prefers generationConfig.maxOutputTokens over provider params and default',
    facadeCallback18,
  );

  it(
    'getCompletionBudget falls back to provider getModelParams when generationConfig has no budget',
    facadeCallback19,
  );

  it(
    'getCompletionBudget falls back to the default (65536) when nothing is set',
    facadeCallback20,
  );

  it(
    'getCompletionBudget prefers the live settingsService maxOutputTokens over all other sources',
    facadeCallback21,
  );

  it(
    'getCompletionBudget rejects a non-positive context limit',
    facadeCallback22,
  );

  it(
    'getCompletionBudget rejects a live budget that consumes the context',
    facadeCallback23,
  );

  it(
    'getCompletionBudget rejects a generation budget that consumes the context',
    facadeCallback24,
  );

  it(
    'getCompletionBudget rejects a provider budget that consumes the context',
    facadeCallback25,
  );

  it('estimatePendingTokens returns 0 for empty contents', facadeCallback26);

  it(
    'estimatePendingTokens delegates to historyService.estimateTokensForContents for non-empty input',
    facadeCallback27,
  );

  // PROPERTY: asNumber round-trips any finite number
  it('asNumber round-trips any finite number (property)', facadeCallback28);

  // PROPERTY: extractCompletionBudgetFromParams resolves the FIRST candidate
  // key that carries a finite number, for any ordering of the candidate set.
  it(
    'extractCompletionBudgetFromParams resolves the first finite candidate (property)',
    facadeCallback29,
  );

  // PROPERTY: estimatePendingTokens is always 0 for an empty contents array
  // regardless of the HistoryService state.
  it(
    'estimatePendingTokens is always 0 for empty contents (property)',
    facadeCallback30,
  );
});

function facadeCallback0(): void {
  vi.clearAllMocks();
}

async function facadeCallback1(): Promise<void> {
  const harness = buildEnforcerHarness();
  const contents: IContent[] = [
    textContent('human', 'small prompt'),
    textContent('ai', 'small answer'),
  ];
  // Force the token estimate well below the threshold.
  vi.spyOn(
    harness.historyService,
    'estimateTokensForContents',
  ).mockResolvedValue(100);
  vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
    undefined,
  );

  const result = await harness.enforcer.enforce(
    buildEnvelope(contents, contents),
    'prompt-p26-1',
  );
  expect(result).toBe(contents);
  expect(harness.performCompression).not.toHaveBeenCalled();
}

async function facadeCallback2(): Promise<void> {
  const harness = buildEnforcerHarness({
    compressionThreshold: 0.1,
    contextLimit: 100000,
    generationConfig: { maxOutputTokens: 100 },
  });
  const contents: IContent[] = [textContent('human', 'small pending prompt')];
  vi.spyOn(
    harness.historyService,
    'estimateTokensForContents',
  ).mockResolvedValue(1);
  const finalizedEstimate = vi.fn(async () => 15000);
  harness.deps.estimateFinalizedPromptTokens = finalizedEstimate;

  await harness.enforcer.enforce(
    buildEnvelope(contents, contents),
    'prompt-finalized-envelope',
  );

  expect(finalizedEstimate).toHaveBeenCalled();
  expect(harness.performCompression).toHaveBeenCalled();
}

async function facadeCallback3(): Promise<void> {
  const { settings, config, providerRuntime } = statefulRuntime(
    createPromptTokenizerFactory(),
    'stateful-responses-enforcement',
  );

  const provider = new OpenAIResponsesProvider(
    'stateful-test-token',
    'https://api.openai.com/v1',
  );

  const harness = buildEnforcerHarness({
    compressionThreshold: 0.5,
    contextLimit: 20_000,
    generationConfig: { maxOutputTokens: 100 },
  });

  const retainedParent: IContent = retainedParentFixture();

  harness.historyService.add(textContent('human', 'retained question'));

  harness.historyService.add(retainedParent);

  await harness.historyService.waitForTokenUpdates();

  const pending = textContent('human', 'small wire delta');

  const effectiveEstimates: PromptEnvelopeEstimate[] = [];

  const estimateAtSendSeam = createStatefulEstimator(
    provider,
    settings,
    config,
    providerRuntime,
    effectiveEstimates,
  );

  harness.deps.estimateFinalizedPromptTokens = estimateAtSendSeam;

  harness.performCompression.mockImplementation(async () => {
    harness.historyService.clear();
    harness.historyService.add(
      textContent('human', 'compressed retained summary'),
    );
    return PerformCompressionResult.COMPRESSED;
  });

  const result = await harness.enforcer.enforce(
    buildEnvelope(
      await Array.fromAsync(
        harness.historyService.getCuratedForProviderStream([pending]),
      ),
      [pending],
    ),
    'stateful-effective-threshold',
    provider,
  );

  const initialStateful = requireStatefulEstimate(effectiveEstimates);

  const finalEstimate = requireLastEstimate(effectiveEstimates);

  expect(initialStateful.transmittedTokens).toBeLessThan(10_000);

  expect(initialStateful).toMatchObject({
    retainedBaselineTokens: 12_050,
    effectiveTokens: initialStateful.estimatedPromptTokens,
    statefulParentUsed: true,
  });

  // The wire body carries the system instruction (and tools when
  // present), but a stateful turn with an observed retained baseline
  // counts only the new input in the incremental estimate: the re-sent
  // instructions/tools are retained server-side inside the parent
  // baseline and are not re-billed, so the incremental is strictly
  // smaller than the transmitted wire body whenever those keys carry
  // content (issue #3481).
  expect(initialStateful.incrementalTokens).toBeLessThan(
    initialStateful.transmittedTokens,
  );

  expect(12_050 + initialStateful.incrementalTokens).toBe(
    initialStateful.estimatedPromptTokens,
  );

  expect(finalEstimate).toMatchObject({
    transmittedTokens: finalEstimate.estimatedPromptTokens,
    retainedBaselineTokens: 0,
    effectiveTokens: finalEstimate.estimatedPromptTokens,
    statefulParentUsed: false,
  });

  expect(finalEstimate.estimatedPromptTokens).toBeLessThan(
    initialStateful.estimatedPromptTokens,
  );

  const resultTexts = result
    .flatMap((content) => content.blocks)
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text);

  expect(resultTexts).toContain('compressed retained summary');

  expect(resultTexts).toContain('small wire delta');
}

async function facadeCallback4(): Promise<void> {
  const { settings, config, providerRuntime } = statefulRuntime(
    createAmplifyingPromptTokenizerFactory(),
    'stateful-responses-overflow',
  );

  const provider = new OpenAIResponsesProvider(
    'stateful-overflow-token',
    'https://api.openai.com/v1',
  );

  const harness = buildEnforcerHarness({
    compressionThreshold: 0.5,
    contextLimit: 2_000,
    generationConfig: { maxOutputTokens: 100 },
  });

  harness.historyService.add(textContent('human', 'retained question'));

  harness.historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'retained answer' }],
    metadata: {
      id: 'resp-overflow-parent',
      responsesStored: true,
      usage: {
        promptTokens: 700,
        completionTokens: 20,
        totalTokens: 720,
      },
    },
  });

  await harness.historyService.waitForTokenUpdates();

  const pending = textContent(
    'human',
    'Continue the retained analysis with one additional observation.',
  );

  const estimates: PromptEnvelopeEstimate[] = [];

  harness.deps.estimateFinalizedPromptTokens = createStatefulEstimator(
    provider,
    settings,
    config,
    providerRuntime,
    estimates,
  );

  harness.performCompression.mockResolvedValue(
    PerformCompressionResult.COMPRESSED,
  );

  harness.performFallbackCompression.mockResolvedValue(false);

  let overflow: unknown;

  try {
    await harness.enforcer.enforce(
      buildEnvelope(
        await Array.fromAsync(
          harness.historyService.getCuratedForProviderStream([pending]),
        ),
        [pending],
      ),
      'stateful-ineffective-overflow',
      provider,
    );
  } catch (error) {
    overflow = error;
  }

  expect(overflow).toBeInstanceOf(ContextOverflowError);

  const contextOverflow = requireContextOverflow(overflow);

  const finalEstimate = requireLastEstimate(estimates);

  expect(contextOverflow.estimatedRequestTokenCount).toBe(
    finalEstimate.estimatedPromptTokens,
  );

  expect(contextOverflow.remainingTokenCount).toBe(905);

  expect(contextOverflow.message).toContain(
    'Last-resort tool-response truncation replaced 0 response(s)',
  );
}

async function facadeCallback5(): Promise<void> {
  // Use a tiny completion budget so the compression threshold is dominated
  // by the token estimate rather than the default 65_536 budget.
  const harness = buildEnforcerHarness({
    compressionThreshold: 0.1,
    contextLimit: 100000,
    generationConfig: { maxOutputTokens: 100 },
  });
  const contents: IContent[] = [
    textContent('human', 'prompt that pushes us over'),
    textContent('ai', 'answer'),
  ];
  // Project way over the threshold but under the hard limit so compression
  // fires and the recomposed result fits.
  const estimateSpy = vi
    .spyOn(harness.historyService, 'estimateTokensForContents')
    .mockResolvedValue(20000);
  vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
    undefined,
  );
  harness.historyService.addAll(contents);

  await harness.enforcer.enforce(
    buildEnvelope(contents, contents),
    'prompt-p26-2',
  );
  expect(harness.performCompression).toHaveBeenCalledTimes(1);
  expect(harness.performCompression).toHaveBeenCalledWith('prompt-p26-2', {
    bypassCooldown: true,
    trigger: 'auto',
  });
  estimateSpy.mockRestore();
}

async function facadeCallback6(): Promise<void> {
  const harness = buildEnforcerHarness({
    compressionThreshold: 0.1,
    contextLimit: 100000,
    generationConfig: { maxOutputTokens: 100 },
  });
  const pendingContents: IContent[] = [
    textContent('human', 'pending user prompt'),
    textContent('ai', 'pending ai text'),
  ];
  const curatedAfterCompression: IContent[] = [
    textContent('human', 'compressed summary'),
  ];
  const estimateSpy = vi
    .spyOn(harness.historyService, 'estimateTokensForContents')
    .mockResolvedValue(100);
  vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
    undefined,
  );
  harness.historyService.addAll(curatedAfterCompression);

  const result = await harness.enforcer.enforce(
    buildEnvelope(pendingContents, pendingContents),
    'prompt-p26-3',
  );
  // After compression the projection (100 + completionBudget) must be under
  // the safety-adjusted limit; the enforcer recomposes pending onto curated.
  // Assert OBSERVABLE text content — the exact array shape is subject to
  // provider-content normalization (dedupe/adjacency), which is itself
  // behavior pinned elsewhere.
  const allText = result
    .flatMap((c) => c.blocks)
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  expect(allText).toContain('pending user prompt');
  expect(allText).toContain('pending ai text');
  estimateSpy.mockRestore();
}

async function facadeCallback7(): Promise<void> {
  const harness = buildEnforcerHarness({
    compressionThreshold: 0.1,
    contextLimit: 1000,
    performCompressionResult: PerformCompressionResult.FAILED,
  });
  // Make the fallback fail too.
  harness.performFallbackCompression.mockResolvedValue(false);
  const contents: IContent[] = [
    textContent('human', 'prompt'),
    textContent('ai', 'answer'),
  ];
  // Always project over the hard limit.
  vi.spyOn(
    harness.historyService,
    'estimateTokensForContents',
  ).mockResolvedValue(10_000_000);
  vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
    undefined,
  );
  harness.historyService.addAll(contents);

  await expect(
    harness.enforcer.enforce(
      buildEnvelope(contents, contents),
      'prompt-p26-overflow',
    ),
  ).rejects.toThrow(/context limit/i);
}

async function facadeCallback8(): Promise<void> {
  const harness = buildEnforcerHarness({
    compressionThreshold: 0.1,
    contextLimit: 1000,
  });
  const contents: IContent[] = [textContent('human', 'prompt')];
  vi.spyOn(
    harness.historyService,
    'estimateTokensForContents',
  ).mockResolvedValue(10_000_000);
  vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
    undefined,
  );

  await expect(
    harness.enforcer.enforce(
      buildEnvelope(contents, undefined),
      'prompt-p26-noboundary',
    ),
  ).rejects.toThrow(/unrecoverable/i);
}

async function facadeCallback9(): Promise<void> {
  const harness = buildEnforcerHarness();
  const contents: IContent[] = [textContent('human', 'small')];
  // Over the compression threshold but UNDER the hard limit.
  vi.spyOn(
    harness.historyService,
    'estimateTokensForContents',
  ).mockResolvedValue(100);
  vi.spyOn(harness.historyService, 'waitForTokenUpdates').mockResolvedValue(
    undefined,
  );

  const result = await harness.enforcer.enforce(
    buildEnvelope(contents, undefined),
    'prompt-p26-under-hard',
  );
  expect(result).toBe(contents);
}

async function facadeCallback10(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 100 }),
      async (smallEstimate: number) => {
        const harness = buildEnforcerHarness();
        const contents: IContent[] = [
          textContent('human', 'q'),
          textContent('ai', 'a'),
        ];
        vi.spyOn(
          harness.historyService,
          'estimateTokensForContents',
        ).mockResolvedValue(smallEstimate);
        vi.spyOn(
          harness.historyService,
          'waitForTokenUpdates',
        ).mockResolvedValue(undefined);

        const result = await harness.enforcer.enforce(
          buildEnvelope(contents, contents),
          'prompt-prop-1',
        );
        expect(result).toBe(contents);
        expect(harness.performCompression).not.toHaveBeenCalled();
      },
    ),
  );
}

function facadeCallback11(): void {
  expect(asNumber(42)).toBe(42);
}

function facadeCallback12(): void {
  expect(asNumber('128')).toBe(128);
}

function facadeCallback13(): void {
  expect(asNumber('not-a-number')).toBeUndefined();
  expect(asNumber(null)).toBeUndefined();
  expect(asNumber(undefined)).toBeUndefined();
  expect(asNumber(NaN)).toBeUndefined();
  expect(asNumber(Infinity)).toBeUndefined();
}

function facadeCallback14(): void {
  expect(extractCompletionBudgetFromParams({ maxOutputTokens: 4096 })).toBe(
    4096,
  );
}

function facadeCallback15(): void {
  expect(extractCompletionBudgetFromParams({ maxTokens: 2048 })).toBe(2048);
}

function facadeCallback16(): void {
  expect(extractCompletionBudgetFromParams({ max_output_tokens: 1024 })).toBe(
    1024,
  );
  expect(extractCompletionBudgetFromParams({ max_tokens: 512 })).toBe(512);
}

function facadeCallback17(): void {
  expect(extractCompletionBudgetFromParams({})).toBeUndefined();
  expect(extractCompletionBudgetFromParams(undefined)).toBeUndefined();
}

function facadeCallback18(): void {
  const cfg = { maxOutputTokens: 8192 } as Record<string, unknown>;
  expect(
    getCompletionBudget(cfg as never, 'm', undefined, undefined, 131_072),
  ).toBe(8192);
}

function facadeCallback19(): void {
  const provider = {
    getModelParams: () => ({ maxTokens: 4096 }),
  } as unknown as IProvider;
  expect(getCompletionBudget({}, 'm', provider, undefined, 131_072)).toBe(4096);
}

function facadeCallback20(): void {
  expect(getCompletionBudget({}, 'm', undefined, undefined, 131_072)).toBe(
    65_536,
  );
}

function facadeCallback21(): void {
  const { cfg, settingsService } =
    observeGetCompletionBudgetPrefersTheLiveSettingsServiceMaxOutputTokensOverAllOtherSources();
  expect(
    getCompletionBudget(cfg as never, 'm', undefined, settingsService, 131_072),
  ).toBe(32768);
}

function facadeCallback22(): void {
  expect(() => getCompletionBudget({}, 'm', undefined, undefined, 0)).toThrow(
    RangeError,
  );
}

function facadeCallback23(): void {
  const { settingsService } =
    observeGetCompletionBudgetRejectsALiveBudgetThatConsumesTheContext();
  expect(() =>
    getCompletionBudget({}, 'm', undefined, settingsService, 131_072),
  ).toThrow(InvalidContextBudgetError);
}

function facadeCallback24(): void {
  const cfg = { maxOutputTokens: 131_072 } as Record<string, unknown>;
  expect(() =>
    getCompletionBudget(cfg as never, 'm', undefined, undefined, 131_072),
  ).toThrow(InvalidContextBudgetError);
}

function facadeCallback25(): void {
  const provider = {
    getModelParams: () => ({ maxTokens: 131_072 }),
  } as unknown as IProvider;
  expect(() =>
    getCompletionBudget({}, 'm', provider, undefined, 131_072),
  ).toThrow(InvalidContextBudgetError);
}

async function facadeCallback26(): Promise<void> {
  const historyService = new HistoryService();
  const estimate = await estimatePendingTokens([], historyService, 'm');
  expect(estimate).toBe(0);
}

async function facadeCallback27(): Promise<void> {
  const historyService = new HistoryService();
  const spy = vi
    .spyOn(historyService, 'estimateTokensForContents')
    .mockResolvedValue(777);
  const contents: IContent[] = [textContent('human', 'hi')];
  const estimate = await estimatePendingTokens(contents, historyService, 'm');
  expect(estimate).toBe(777);
  expect(spy).toHaveBeenCalledWith(contents, 'm');
}

function facadeCallback28(): void {
  fc.assert(
    fc.property(fc.integer({ min: -100000, max: 100000 }), (n: number) => {
      expect(asNumber(n)).toBe(n);
    }),
  );
}

function facadeCallback29(): void {
  const keyArb = fc.constantFrom(
    'maxOutputTokens',
    'maxTokens',
    'max_output_tokens',
    'max_tokens',
  );
  const valueArb = fc.integer({ min: 1, max: 100000 });
  fc.assert(
    fc.property(keyArb, valueArb, (key: string, value: number) => {
      const params: Record<string, unknown> = { [key]: value };
      expect(extractCompletionBudgetFromParams(params)).toBe(value);
    }),
  );
}

async function facadeCallback30(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1 }), async (model: string) => {
      const historyService = new HistoryService();
      const estimate = await estimatePendingTokens([], historyService, model);
      expect(estimate).toBe(0);
    }),
  );
}

import {
  toStream,
  textContent,
  buildEnforcerHarness,
  buildEnvelope,
  createPromptTokenizerFactory,
  createAmplifyingPromptTokenizerFactory,
  recordPreparedEstimate,
  requireStatefulEstimate,
  requireLastEstimate,
  requireContextOverflow,
} from './compression-characterization-test-helpers.js';

function retainedParentFixture(): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'retained answer' }],
    metadata: {
      id: 'resp-retained-parent',
      responsesStored: true,
      usage: {
        promptTokens: 12_000,
        cachedTokens: 11_000,
        completionTokens: 50,
        totalTokens: 12_050,
      },
    },
  };
}

function createStatefulEstimator(
  provider: OpenAIResponsesProvider,
  settings: SettingsService,
  config: ReturnType<typeof createRuntimeConfigStub>,
  providerRuntime: ReturnType<typeof createProviderRuntimeContext>,
  estimates: PromptEnvelopeEstimate[],
): (candidate: IContent[]) => Promise<number> {
  return async (candidate: IContent[]): Promise<number> => {
    const prepared = await prepareAtSendSeam(provider, {
      ...createProviderCallOptions({
        providerName: provider.name,
        settings,
        config,
        runtime: providerRuntime,
        resolved: {
          model: 'gpt-4o',
          baseURL: 'https://api.openai.com/v1',
          telemetry: { providerName: provider.name },
        },
        ephemerals: { 'responses-stateful': true },
      }),
      contents: toStream(candidate),
    });
    return recordPreparedEstimate(prepared, estimates);
  };
}

function statefulRuntime(
  tokenizerFactory: ReturnType<typeof createPromptTokenizerFactory>,
  runtimeId: string,
): {
  settings: SettingsService;
  config: ReturnType<typeof createRuntimeConfigStub>;
  providerRuntime: ReturnType<typeof createProviderRuntimeContext>;
} {
  const settings = new SettingsService();
  const config = createRuntimeConfigStub(settings, {
    getTokenizerFactory: () => tokenizerFactory,
  });
  const providerRuntime = createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId,
  });

  return { settings, config, providerRuntime };
}
