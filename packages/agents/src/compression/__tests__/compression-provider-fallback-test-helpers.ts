/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionHandler } from '../CompressionHandler.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import {
  EmptySummaryError,
  type CompressionStrategy,
} from '@vybestack/llxprt-code-core/core/compression/types.js';

interface CandidateControl {
  active: boolean;
  calls: number;
  noops: number;
}

function fallbackFixtureOutcome(
  control: CandidateControl,
  count: number,
): boolean {
  if (!control.active) throw new EmptySummaryError('top-down-truncation');
  control.calls++;
  return control.calls > control.noops && count > 0;
}

function installFallbackStrategies(
  control: CandidateControl,
  candidateHistory: IContent[],
): void {
  const metadata = {
    originalMessageCount: 1,
    compressedMessageCount: candidateHistory.length,
    strategyUsed: 'top-down-truncation' as const,
    llmCallMade: false,
  };
  const noop = {
    kind: 'noop' as const,
    reason: 'already-under-target' as const,
    metadata,
  };
  const strategy: CompressionStrategy = {
    name: 'top-down-truncation',
    requiresLLM: false,
    trigger: { mode: 'threshold', defaultThreshold: 0.8 },
    compress: async () =>
      fallbackFixtureOutcome(control, candidateHistory.length)
        ? { kind: 'applied', newHistory: candidateHistory, metadata }
        : noop,
  };
  vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue(
    strategy,
  );
  const compressDisk = TopDownTruncationStrategy.prototype.compressDisk;
  vi.spyOn(
    TopDownTruncationStrategy.prototype,
    'compressDisk',
  ).mockImplementation(async function (
    this: TopDownTruncationStrategy,
    context,
  ) {
    if (!control.active) return compressDisk.call(this, context);
    if (!fallbackFixtureOutcome(control, candidateHistory.length)) return noop;
    if (!(context.history instanceof DetachedHistoryJournal))
      throw new Error('Expected disk fixture rows');
    const rows = context.history;
    const start = rows.length;
    for (const row of candidateHistory) rows.append(row);
    const readRow = rows.readRow.bind(rows);
    vi.spyOn(rows, 'readRow').mockImplementation((index) => {
      const value = readRow(index);
      return index >= start ? candidateHistory[index - start] : value;
    });
    return { kind: 'applied', start, metadata };
  });
}

export function installProviderDiskFixture(candidateHistory: IContent[]): void {
  installFallbackStrategies(
    { active: true, calls: 0, noops: 0 },
    candidateHistory,
  );
}

export async function seedFallbackCooldown(
  handler: CompressionHandler,
  candidateHistory: IContent[],
): Promise<{ activateCandidateAfter(noopCalls: number): void }> {
  const control: CandidateControl = { active: false, calls: 0, noops: 0 };
  installFallbackStrategies(control, candidateHistory);
  const history = handler['historyService'];
  history.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'seed failure input' }],
  });
  await history.waitForTokenUpdates();
  const tokens = vi.spyOn(history, 'getTotalTokens').mockReturnValue(100_000);
  const estimation = vi
    .spyOn(history, 'estimateTokensForContents')
    .mockRejectedValue(new EmptySummaryError('top-down-truncation'));
  const compressDisk = OneShotStrategy.prototype.compressDisk;
  vi.spyOn(OneShotStrategy.prototype, 'compressDisk').mockImplementation(
    function (this: OneShotStrategy, context, candidate) {
      control.calls++;
      return compressDisk.call(this, context, candidate);
    },
  );
  await handler.performCompression('seed-failure-1');
  await handler.performCompression('seed-failure-2');
  await handler.performCompression('seed-failure-3');
  return {
    activateCandidateAfter: (noopCalls) => {
      tokens.mockRestore();
      estimation.mockRestore();
      vi.spyOn(
        handler['runtimeContext'].ephemerals,
        'compressionStrategy',
      ).mockReturnValue('one-shot');
      control.noops = noopCalls;
      control.active = true;
    },
  };
}

export function makeStoredAi(id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: `stored answer ${id}` }],
    metadata: {
      id,
      responsesStored: true,
      providerBaseURL: 'https://api.openai.com/v1',
      providerMetadata: { custom: `metadata ${id}` },
    },
  };
}

export function makeCompressionSnapshot(label: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: label }],
    metadata: {
      synthetic: true,
      isSummary: true,
      reason: 'compression-state-snapshot',
      chronology: { seq: 3, userTurn: 2, step: 1, recordedAt: 0 },
    },
  };
}

export function estimateBookkeepingProjection(
  contents: IContent[],
): Promise<number> {
  const hasCommittedSnapshot = contents.some((content) =>
    content.blocks.some(
      (block) =>
        block.type === 'text' && block.text.includes('committed snapshot'),
    ),
  );
  return Promise.resolve(hasCommittedSnapshot ? 10 : 150_000);
}

export function restoredPromptTokenBaseline(baseline: number | null): number {
  return baseline ?? 0;
}

export function makeFallbackFacadeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}
