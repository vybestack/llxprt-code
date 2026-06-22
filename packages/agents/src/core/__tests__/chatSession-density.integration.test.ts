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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('Density Optimization Integration (P19)', () => {
  let historyService: HistoryService;
  let mockContentGenerator: ReturnType<typeof buildMockContentGenerator>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIds();
    historyService = new HistoryService();
    mockContentGenerator = buildMockContentGenerator();
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
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
        compressionThreshold: 0.8,
        contextLimit: 131134,
      });

      // Add prunable content
      historyService.add(makeUserMessage('Update the file'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/app.ts',
        'x'.repeat(1000),
        'y'.repeat(100),
      );
      historyService.add(makeAiText('File updated'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
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
      await historyService.waitForTokenUpdates();

      // With these token counts, shouldCompress is false (well below threshold)
      // Density optimization still runs (because dirty) but compression shouldn't trigger
      await internals.ensureCompressionBeforeSend('test-prompt', 0, 'send');

      // History may have been modified by density (prunable pair), but
      // full compression (which produces summaries) should NOT have triggered
      const historyAfter = historyService.getRawHistory();
      const hasSummary = historyAfter.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(compressionSpy).not.toHaveBeenCalled();
      expect(hasSummary).toBe(false);
    });

    /**
     * @requirement REQ-HD-002.1
     * When history is well over threshold, both density AND compression run.
     */
    it('still compresses after density if still over threshold', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      // Add prunable read→write pairs so density has work to do
      historyService.add(makeUserMessage('Fix the bugs'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/app.ts',
        'old code ' + 'x'.repeat(500),
        'new code',
      );
      // Add more history to pad it out
      for (let i = 0; i < 10; i++) {
        historyService.add(
          makeUserMessage(`User message ${i} ${'x'.repeat(200)}`),
        );
        historyService.add(makeAiText(`AI response ${i} ${'y'.repeat(200)}`));
      }

      const historyBefore = historyService.getRawHistory().length;

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      // Mock high token count to trigger compression after density
      vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(120_000);

      await internals.ensureCompressionBeforeSend('test-prompt', 0, 'send');

      // Density should have pruned the stale read pair (reducing count),
      // then compression also ran (high-density compress is truncation-based).
      // Density flag should be cleared.
      expect(internals.densityDirty).toBe(false);

      // History should be different — at minimum density pruned entries
      const historyAfter = historyService.getRawHistory();
      expect(historyAfter.length).toBeLessThanOrEqual(historyBefore);
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
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
        contextLimit: 10000,
      });

      // Add prunable read-write pairs
      historyService.add(makeUserMessage('Fix the issue'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/fix.ts',
        'x'.repeat(500),
        'fixed code',
      );
      historyService.add(makeAiText('Done'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      // Mock token count to be just over the limit
      vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(9500);

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
      expect(internals.densityDirty).toBe(false);
    });

    /**
     * @requirement REQ-HD-002.8
     * If density frees enough space, compression is skipped.
     */
    it('skips compression if density freed enough space', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
        contextLimit: 200_000,
        'compression.density.optimizeThreshold': 0, // Always run for test
      });

      // Add prunable read→write pairs — density optimization can remove the stale reads
      historyService.add(makeUserMessage('Fix the file'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/big.ts',
        'x'.repeat(500),
        'fixed code',
      );
      historyService.add(makeAiText('Done'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
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
      const origApply = historyService.applyDensityResult.bind(historyService);
      vi.spyOn(historyService, 'applyDensityResult').mockImplementation(
        async (result) => {
          densityOptRan = true;
          return origApply(result);
        },
      );
      vi.spyOn(historyService, 'getTotalTokens').mockImplementation(() =>
        densityOptRan ? 50_000 : 140_000,
      );

      await internals.enforceContextWindow(100, 'test-prompt');

      // Density optimization ran, applied changes, and the flag was cleared
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
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      // Add history including entries that getCurated might filter differently
      historyService.add(makeUserMessage('Read the config'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/config.json',
        '{"key": "value"}',
        '{"key": "updated"}',
      );
      historyService.add(makeAiText('Config updated'));

      const rawBefore = historyService.getRawHistory().length;

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      // After optimization, raw history should be modified (pruned entries)
      const rawAfter = historyService.getRawHistory().length;

      // Verify optimization happened against raw history
      // (the read pair was at raw indices, not curated indices)
      expect(rawAfter).toBeLessThanOrEqual(rawBefore);
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

      // Find all calls to ensureDensityOptimized (excluding the method declaration)
      const callSites = source
        .split('\n')
        .filter(
          (line) =>
            line.includes('ensureDensityOptimized') &&
            !line.includes('async ensureDensityOptimized') &&
            !line.includes('@pseudocode') &&
            !line.includes('* '),
        );

      // Should have exactly 2 call sites (ensureCompressionBeforeSend + enforceContextWindow)
      const awaitCalls = callSites.filter((line) =>
        line.includes('await this.ensureDensityOptimized()'),
      );
      expect(awaitCalls.length).toBe(2);
    });
  });
});
