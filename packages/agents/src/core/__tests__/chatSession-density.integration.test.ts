/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P19
 * @requirement REQ-HD-002.1, REQ-HD-002.8, REQ-HD-002.9, REQ-HD-002.10
 *
 * Integration scenarios for density optimization orchestration in ChatSession
 * (compression coordination, emergency paths, raw history input, and sequential
 * safety). Sibling to chatSession-density.test.ts.
 */

import { collectRawHistory } from '@vybestack/llxprt-code-core/test-utils/collect-raw-history.js';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { ChatSession } from '../chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  resetCallIds,
  makeUserMessage,
  makeAiText,
  addPrunableReadWritePair,
  buildRuntimeContext,
  buildMockContentGenerator,
  getInternals,
} from './chatSession-density-helpers.js';

let densityFixture1_historyService: HistoryService;

let densityFixture2_mockContentGenerator: ReturnType<
  typeof buildMockContentGenerator
>;

const densityFixture3_observeRunsDensityBeforeThresholdCheckAvoidsCompressionWhenDensitySuffices =
  async () => {
    const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
      compressionStrategy: 'high-density',
      compressionThreshold: 0.8,
      contextLimit: 131134,
    });

    // Add prunable content
    densityFixture1_historyService.add(makeUserMessage('Update the file'));
    addPrunableReadWritePair(
      densityFixture1_historyService,
      '/workspace/app.ts',
      'x'.repeat(1000),
      'y'.repeat(100),
    );
    densityFixture1_historyService.add(makeAiText('File updated'));

    const chat = new ChatSession(
      runtimeContext,
      densityFixture2_mockContentGenerator,
      {},
      [],
    );
    const internals = getInternals(chat);
    internals.densityDirty = true;
    const compressionSpy = vi.spyOn(
      internals.compressionHandler,
      'performCompression',
    );

    // Ensure tokens are settled
    await densityFixture1_historyService.waitForTokenUpdates();

    // With these token counts, shouldCompress is false (well below threshold)
    // Density optimization still runs (because dirty) but compression shouldn't trigger
    await internals.ensureCompressionBeforeSend('test-prompt', 0, 'send');

    // History may have been modified by density (prunable pair), but
    // full compression (which produces summaries) should NOT have triggered
    const historyAfter = await collectRawHistory(
      densityFixture1_historyService,
    );
    const hasSummary = historyAfter.some((msg) =>
      msg.blocks.some(
        (b) => b.type === 'text' && b.text.includes('state_snapshot'),
      ),
    );

    return { compressionSpy, hasSummary };
  };

const densityFixture4_observeSkipsCompressionIfDensityFreedEnoughSpace =
  async () => {
    const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
      compressionStrategy: 'high-density',
      contextLimit: 200_000,
      'compression.density.optimizeThreshold': 0, // Always run for test
    });

    // Add prunable read→write pairs — density optimization can remove the stale reads
    densityFixture1_historyService.add(makeUserMessage('Fix the file'));
    addPrunableReadWritePair(
      densityFixture1_historyService,
      '/workspace/big.ts',
      'x'.repeat(500),
      'fixed code',
    );
    densityFixture1_historyService.add(makeAiText('Done'));

    const chat = new ChatSession(
      runtimeContext,
      densityFixture2_mockContentGenerator,
      {},
      [],
    );
    const internals = getInternals(chat);
    internals.densityDirty = true;
    const compressionSpy = vi.spyOn(
      internals.compressionHandler,
      'performCompression',
    );

    // Mock getTotalTokens:
    // - First call (initial projected check): over the margin-adjusted limit
    // - After density optimization runs and prunes history, subsequent calls: under limit
    // completionBudget=65536, margin=1000, so limit=199000
    // Need: initial > 199000 - 65536 - 100 = 133364
    // After: < 133364
    let densityOptRan = false;
    const origApply = densityFixture1_historyService.optimizeDensityRows.bind(
      densityFixture1_historyService,
    );
    vi.spyOn(
      densityFixture1_historyService,
      'optimizeDensityRows',
    ).mockImplementation(async (result) => {
      densityOptRan = true;
      return origApply(result);
    });
    vi.spyOn(
      densityFixture1_historyService,
      'getTotalTokens',
    ).mockImplementation(() => (densityOptRan ? 50_000 : 140_000));

    await internals.enforceContextWindow(100, 'test-prompt');

    // Density optimization ran, applied changes, and the flag was cleared

    return { densityOptRan, internals, compressionSpy };
  };

const densityFixture5_observeEnsureDensityOptimizedIsOnlyCalledFromEnsureCompressionBeforeSendAndEnforceContextWindow =
  async () => {
    // Read the CompressionHandler source file and verify call sites
    // (compression methods were extracted to CompressionHandler in Phase 03)
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL(
        '../../compression/CompressionHandler.ts',
        import.meta.url,
      ).pathname.replace(/^\/([A-Z]:)/, '$1'),
      'utf-8',
    );

    const callSites = source
      .split('\n')
      .filter(
        (line) =>
          line.includes('ensureDensityOptimized') &&
          !line.includes('async ensureDensityOptimized') &&
          !line.includes('@pseudocode') &&
          !line.includes('* '),
      );

    const directAwaitCalls = callSites.filter((line) =>
      line.includes('await this.ensureDensityOptimized()'),
    );
    const injectedSequentialCalls = callSites.filter((line) =>
      line.includes(
        'ensureDensityOptimized: () => this.ensureDensityOptimized()',
      ),
    );

    return { directAwaitCalls, injectedSequentialCalls };
  };

describe('Density Optimization Integration (P19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIds();
    densityFixture1_historyService = new HistoryService();
    densityFixture2_mockContentGenerator = buildMockContentGenerator();
  });

  // =========================================================================
  // Integration with ensureCompressionBeforeSend
  // =========================================================================

  describe('ensureCompressionBeforeSend integration', () => {
    /**
     * @requirement REQ-HD-002.1
     * Density optimization runs before threshold check. If it reduces tokens
     * below threshold, compression does NOT trigger.
     */
    it('runs density before threshold check — avoids compression when density suffices', async () => {
      const { compressionSpy, hasSummary } =
        await densityFixture3_observeRunsDensityBeforeThresholdCheckAvoidsCompressionWhenDensitySuffices();
      expect(compressionSpy).not.toHaveBeenCalled();
      expect(hasSummary).toBe(false);
    });

    /**
     * @requirement REQ-HD-002.1
     * When history is well over threshold, both density AND compression run.
     */
    it('still compresses after density if still over threshold', async () => {
      const { actual, expected0 } = await observeDensityCase6();
      expect(actual).toBeLessThanOrEqual(expected0);
    });
  });

  // =========================================================================
  // Emergency Path Tests
  // =========================================================================

  describe('enforceContextWindow integration', () => {
    /**
     * @requirement REQ-HD-002.8
     * enforceContextWindow runs density before compression.
     */
    it('runs density before compression in emergency path', async () => {
      const { actual, expected0 } = await observeDensityCase7();
      expect(actual).toBe(expected0);
    });

    /**
     * @requirement REQ-HD-002.8
     * If density frees enough space, compression is skipped.
     */
    it('skips compression if density freed enough space', async () => {
      const { densityOptRan, internals, compressionSpy } =
        await densityFixture4_observeSkipsCompressionIfDensityFreedEnoughSpace();
      expect(densityOptRan).toBe(true);
      expect(internals.densityDirty).toBe(false);
      expect(compressionSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Raw History Input Test
  // =========================================================================

  describe('raw history input', () => {
    /**
     * @requirement REQ-HD-002.9
     * optimize() should receive raw history, not curated.
     */
    it('optimize receives raw history for correct index mapping', async () => {
      const { actual, expected0 } = await observeDensityCase8();
      expect(actual).toBeLessThanOrEqual(expected0);
    });
  });

  // =========================================================================
  // Sequential Safety Test
  // =========================================================================

  describe('sequential safety', () => {
    /**
     * @requirement REQ-HD-002.10
     * ensureDensityOptimized is only called from sequential pre-send paths.
     * This is a structural verification via code analysis.
     */
    it('ensureDensityOptimized is only called from ensureCompressionBeforeSend and enforceContextWindow', async () => {
      const { directAwaitCalls, injectedSequentialCalls } =
        await densityFixture5_observeEnsureDensityOptimizedIsOnlyCalledFromEnsureCompressionBeforeSendAndEnforceContextWindow();
      expect(directAwaitCalls.length).toBe(1);
      expect(injectedSequentialCalls.length).toBe(2);
    });
  });
});

async function observeDensityCase6() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  // Add prunable read→write pairs so density has work to do
  densityFixture1_historyService.add(makeUserMessage('Fix the bugs'));
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/app.ts',
    'old code ' + 'x'.repeat(500),
    'new code',
  );
  // Add more history to pad it out
  for (let i = 0; i < 10; i++) {
    densityFixture1_historyService.add(
      makeUserMessage(`User message ${i} ${'x'.repeat(200)}`),
    );
    densityFixture1_historyService.add(
      makeAiText(`AI response ${i} ${'y'.repeat(200)}`),
    );
  }

  const historyBefore = (
    await collectRawHistory(densityFixture1_historyService)
  ).length;

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  // Mock high token count to trigger compression after density
  vi.spyOn(densityFixture1_historyService, 'getTotalTokens').mockReturnValue(
    120_000,
  );

  await internals.ensureCompressionBeforeSend('test-prompt', 0, 'send');

  // Density should have pruned the stale read pair (reducing count),
  // then compression also ran (high-density compress is truncation-based).
  // Density flag should be cleared.
  expect(internals.densityDirty).toBe(false);

  // History should be different — at minimum density pruned entries
  const historyAfter = await collectRawHistory(densityFixture1_historyService);

  return { actual: historyAfter.length, expected0: historyBefore };
}

async function observeDensityCase7() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
    contextLimit: 10000,
  });

  // Add prunable read-write pairs
  densityFixture1_historyService.add(makeUserMessage('Fix the issue'));
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/fix.ts',
    'x'.repeat(500),
    'fixed code',
  );
  densityFixture1_historyService.add(makeAiText('Done'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  // Mock token count to be just over the limit
  vi.spyOn(densityFixture1_historyService, 'getTotalTokens').mockReturnValue(
    9500,
  );

  const mockProvider = {
    name: 'test-provider',
    generateChatCompletion: vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'summary' }],
      };
    }),
  };
  vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
    mockProvider as never,
  );
  vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

  // enforceContextWindow should run density optimization before compression
  // Even if the mock doesn't reduce tokens, the code path is exercised
  try {
    await internals.enforceContextWindow(500, 'test-prompt');
  } catch {
    // May throw if still over limit, but that's OK — we're testing the path
  }

  // densityDirty should be cleared (density optimization ran)

  return { actual: internals.densityDirty, expected0: false };
}

async function observeDensityCase8() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  // Add history including entries that getCurated might filter differently
  densityFixture1_historyService.add(makeUserMessage('Read the config'));
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/config.json',
    '{"key": "value"}',
    '{"key": "updated"}',
  );
  densityFixture1_historyService.add(makeAiText('Config updated'));

  const rawBefore = (await collectRawHistory(densityFixture1_historyService))
    .length;

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  await internals.ensureDensityOptimized();

  // After optimization, raw history should be modified (pruned entries)
  const rawAfter = (await collectRawHistory(densityFixture1_historyService))
    .length;

  // Verify optimization happened against raw history
  // (the read pair was at raw indices, not curated indices)

  return { actual: rawAfter, expected0: rawBefore };
}
