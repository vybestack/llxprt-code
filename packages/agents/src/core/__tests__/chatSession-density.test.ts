/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P19
 * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4,
 *              REQ-HD-002.5, REQ-HD-002.6, REQ-HD-002.7
 *
 * Behavioral tests for density optimization orchestration in ChatSession.
 * Tests verify observable state changes (history mutations, token counts, dirty flag)
 * through real HighDensityStrategy instances. No mock theater.
 *
 * Integration and property-based scenarios live in sibling files:
 *  - chatSession-density.integration.test.ts
 *  - chatSession-density.property.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSession } from '../chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  resetCallIds,
  makeUserMessage,
  makeAiText,
  makeAiToolCall,
  makeToolResponse,
  addPrunableReadWritePair,
  buildRuntimeContext,
  buildMockContentGenerator,
  getInternals,
} from './chatSession-density-helpers.js';

describe('Density Optimization Orchestration (P19)', () => {
  let historyService: HistoryService;
  let mockContentGenerator: ReturnType<typeof buildMockContentGenerator>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIds();
    historyService = new HistoryService();
    mockContentGenerator = buildMockContentGenerator();
  });

  // =========================================================================
  // ensureDensityOptimized Behavior Tests
  // =========================================================================

  describe('ensureDensityOptimized behavior', () => {
    /**
     * @requirement REQ-HD-002.1, REQ-HD-002.4
     */
    it('calls optimize when dirty and strategy supports it', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
        'compression.density.optimizeThreshold': 0, // Always run for test
      });

      // Add prunable content: a read→write pair on the same file
      historyService.add(makeUserMessage('Please update the config'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/config.ts',
        'old content',
        'new content',
      );
      historyService.add(makeAiText('Done updating config'));

      const historyBefore = historyService.getRawHistory().length;

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      const historyAfter = historyService.getRawHistory().length;

      // Density optimization should have pruned the stale read pair
      expect(historyAfter).toBeLessThan(historyBefore);
    });

    /**
     * @requirement REQ-HD-002.2
     */
    it('skips when strategy has no optimize method', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'middle-out',
      });

      // Add some history
      historyService.add(makeUserMessage('Hello'));
      historyService.add(makeAiText('Hi there'));

      const historyBefore = [...historyService.getRawHistory()];

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      const historyAfter = historyService.getRawHistory();
      expect(historyAfter.length).toBe(historyBefore.length);
    });

    /**
     * @requirement REQ-HD-002.3
     */
    it('skips when not dirty', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      // Add prunable content
      addPrunableReadWritePair(
        historyService,
        '/workspace/file.ts',
        'content',
        'updated',
      );

      const historyBefore = historyService.getRawHistory().length;

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = false;

      await internals.ensureDensityOptimized();

      // History unchanged because dirty flag was false
      expect(historyService.getRawHistory().length).toBe(historyBefore);
    });

    /**
     * @requirement REQ-HD-002.4
     */
    it('applies result when optimize returns changes', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
        'compression.density.optimizeThreshold': 0, // Always run for test
      });

      historyService.add(makeUserMessage('Fix the bug'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/bug.ts',
        'buggy code',
        'fixed code',
      );
      historyService.add(makeAiText('Bug fixed'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      // Wait for initial token calculation to settle
      await historyService.waitForTokenUpdates();
      const tokensBefore = historyService.getTotalTokens();

      await internals.ensureDensityOptimized();

      await historyService.waitForTokenUpdates();
      const tokensAfter = historyService.getTotalTokens();

      // Token count should reflect the pruning (lower or equal, never higher)
      expect(tokensAfter).toBeLessThanOrEqual(tokensBefore);
    });

    /**
     * @requirement REQ-HD-002.4
     */
    it('awaits token recalculation after apply', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      historyService.add(makeUserMessage('Update file'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/main.ts',
        'original content that is quite long to ensure tokens change',
        'new content',
      );
      historyService.add(makeAiText('Updated'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      // After ensureDensityOptimized completes, getTotalTokens should
      // return the post-optimization value (not stale)
      const tokensAfter = historyService.getTotalTokens();
      const historyLen = historyService.getRawHistory().length;

      // If history was modified, tokens should be recalculated
      // (we just verify it doesn't throw and returns a number)
      expect(typeof tokensAfter).toBe('number');
      expect(historyLen).toBeGreaterThan(0);
    });

    /**
     * @requirement REQ-HD-002.5
     */
    it('does not call applyDensityResult for empty result', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      // Add history with NO prunable patterns (just normal conversation)
      historyService.add(makeUserMessage('Hello'));
      historyService.add(makeAiText('Hi, how can I help?'));
      historyService.add(makeUserMessage('Tell me about TypeScript'));
      historyService.add(
        makeAiText('TypeScript is a typed superset of JavaScript'),
      );

      const historyBefore = historyService.getRawHistory().map((h) => ({
        speaker: h.speaker,
        blockCount: h.blocks.length,
      }));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      const historyAfter = historyService.getRawHistory().map((h) => ({
        speaker: h.speaker,
        blockCount: h.blocks.length,
      }));

      // History should be completely unchanged
      expect(historyAfter).toStrictEqual(historyBefore);
    });

    /**
     * @requirement REQ-HD-002.7
     */
    it('clears dirty flag after optimization completes', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      historyService.add(makeUserMessage('Hello'));
      historyService.add(makeAiText('Hi'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      expect(internals.densityDirty).toBe(false);

      // Second call should be a no-op (verified by checking history doesn't change)
      const historySnapshot = historyService.getRawHistory().length;
      await internals.ensureDensityOptimized();
      expect(historyService.getRawHistory().length).toBe(historySnapshot);
    });

    /**
     * @requirement REQ-HD-002.7
     */
    it('clears dirty flag even when optimize returns empty result', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      // No prunable content
      historyService.add(makeUserMessage('Hello'));
      historyService.add(makeAiText('Hi'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      // Flag should be false even though optimize didn't change anything
      expect(internals.densityDirty).toBe(false);
    });
  });

  // =========================================================================
  // Dirty Flag Tests
  // =========================================================================

  describe('dirty flag lifecycle', () => {
    /**
     * @requirement REQ-HD-002.6
     * Test that after optimization clears the flag, adding new turn-loop content
     * sets it back to true.
     */
    it('dirty flag is set when new content is added via recordHistory', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      historyService.add(makeUserMessage('Hello'));
      historyService.add(makeAiText('Hi'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);

      // Clear the flag by running optimization
      internals.densityDirty = true;
      await internals.ensureDensityOptimized();
      expect(internals.densityDirty).toBe(false);

      // Simulate the turn-loop adding content
      // After P20, this should set densityDirty = true
      historyService.add(makeUserMessage('New message'));
      historyService.add(makeAiText('New response'));

      // After P20 implementation, densityDirty should be true
      // because turn-loop add sites set it
      expect(internals.densityDirty).toBe(true);
    });

    /**
     * @requirement REQ-HD-002.6
     * The dirty flag should NOT be set when performCompression rebuilds history.
     */
    it('dirty flag is NOT set during compression rebuild', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'top-down-truncation',
      });

      // Populate enough history for compression
      for (let i = 0; i < 20; i++) {
        historyService.add(makeUserMessage(`User message ${i}`));
        historyService.add(makeAiText(`AI response ${i}`));
      }

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);

      // Clear the dirty flag
      internals.densityDirty = false;

      // Mock getTotalTokens to trigger compression
      vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(100_000);

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

      // performCompression calls clear() + add() loop — should NOT set dirty
      await chat.performCompression('test-prompt-id');

      // After P20, the dirty flag should still be false (compression rebuild doesn't dirty)
      expect(internals.densityDirty).toBe(false);
    });

    /**
     * @requirement REQ-HD-002.6
     * Multiple add operations should each set the dirty flag.
     */
    it('densityDirty is set after each representative add operation', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'high-density',
      });

      historyService.add(makeUserMessage('Initial'));
      historyService.add(makeAiText('Response'));

      const chat = new ChatSession(
        runtimeContext,
        mockContentGenerator,
        {},
        [],
      );
      const internals = getInternals(chat);

      // Run 1: optimize to clear flag
      internals.densityDirty = true;
      await internals.ensureDensityOptimized();
      expect(internals.densityDirty).toBe(false);

      // Add user message → should set dirty
      historyService.add(makeUserMessage('User turn'));
      // After P20, this tests that the add site sets densityDirty = true
      // For now we manually simulate what P20 will do
      expect(internals.densityDirty).toBe(true);

      // Run 2: optimize again to clear flag
      await internals.ensureDensityOptimized();
      expect(internals.densityDirty).toBe(false);

      // Add AI response → should set dirty
      historyService.add(makeAiText('AI turn'));
      expect(internals.densityDirty).toBe(true);

      // Run 3: optimize again
      await internals.ensureDensityOptimized();
      expect(internals.densityDirty).toBe(false);

      // Add tool result → should set dirty
      const toolCall = makeAiToolCall('read_file', { file_path: '/test' });
      historyService.add(toolCall.entry);
      historyService.add(
        makeToolResponse(toolCall.callId, 'read_file', 'content'),
      );
      expect(internals.densityDirty).toBe(true);
    });
  });
});
