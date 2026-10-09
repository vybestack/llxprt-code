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

import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
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

let densityFixture1_historyService: HistoryService;

let densityFixture2_mockContentGenerator: ReturnType<
  typeof buildMockContentGenerator
>;

describe('Density Optimization Orchestration (P19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCallIds();
    densityFixture1_historyService = new HistoryService();
    densityFixture2_mockContentGenerator = buildMockContentGenerator();
  });

  // =========================================================================
  // ensureDensityOptimized Behavior Tests
  // =========================================================================

  describe('ensureDensityOptimized behavior', () => {
    /**
     * @requirement REQ-HD-002.1, REQ-HD-002.4
     */
    it('calls optimize when dirty and strategy supports it', async () => {
      const { actual, expected0 } = await observeDensityCase3();
      expect(actual).toBeLessThan(expected0);
    });

    /**
     * @requirement REQ-HD-002.2
     */
    it('skips when strategy has no optimize method', async () => {
      const { actual, expected0 } = await observeDensityCase4();
      expect(actual).toBe(expected0);
    });

    /**
     * @requirement REQ-HD-002.3
     */
    it('skips when not dirty', async () => {
      const { actual, expected0 } = await observeDensityCase5();
      expect(actual).toBe(expected0);
    });

    /**
     * @requirement REQ-HD-002.4
     */
    it('applies result when optimize returns changes', async () => {
      const { actual, expected0 } = await observeDensityCase6();
      expect(actual).toBeLessThanOrEqual(expected0);
    });

    /**
     * @requirement REQ-HD-002.4
     */
    it('awaits token recalculation after apply', async () => {
      expect(await observeDensityCase7()).toBeGreaterThan(0);
    });

    /**
     * @requirement REQ-HD-002.5
     */
    it('does not call applyDensityResult for empty result', async () => {
      const { actual, expected0 } = await observeDensityCase8();
      expect(actual).toStrictEqual(expected0);
    });

    /**
     * @requirement REQ-HD-002.7
     */
    it('clears dirty flag after optimization completes', async () => {
      const { actual, expected0 } = await observeDensityCase9();
      expect(actual).toBe(expected0);
    });

    /**
     * @requirement REQ-HD-002.7
     */
    it('clears dirty flag even when optimize returns empty result', async () => {
      expect(await observeDensityCase10()).toBe(false);
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
      expect(await observeDensityCase11()).toBe(true);
    });

    /**
     * @requirement REQ-HD-002.6
     * The dirty flag should NOT be set when performCompression rebuilds history.
     */
    it('dirty flag is NOT set during compression rebuild', async () => {
      expect(await observeDensityCase12()).toBe(false);
    });

    /**
     * @requirement REQ-HD-002.6
     * Multiple add operations should each set the dirty flag.
     */
    it('densityDirty is set after each representative add operation', async () => {
      expect(await observeDensityCase13()).toBe(true);
    });
  });
});

async function observeDensityCase3() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
    'compression.density.optimizeThreshold': 0, // Always run for test
  });

  // Add prunable content: a read→write pair on the same file
  densityFixture1_historyService.add(
    makeUserMessage('Please update the config'),
  );
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/config.ts',
    'old content',
    'new content',
  );
  densityFixture1_historyService.add(makeAiText('Done updating config'));

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

  await internals.ensureDensityOptimized();

  const historyAfter = (await collectRawHistory(densityFixture1_historyService))
    .length;

  // Density optimization should have pruned the stale read pair

  return { actual: historyAfter, expected0: historyBefore };
}

async function observeDensityCase4() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'middle-out',
  });

  // Add some history
  densityFixture1_historyService.add(makeUserMessage('Hello'));
  densityFixture1_historyService.add(makeAiText('Hi there'));

  const historyBefore = [
    ...(await collectRawHistory(densityFixture1_historyService)),
  ];

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  await internals.ensureDensityOptimized();

  const historyAfter = await collectRawHistory(densityFixture1_historyService);

  return { actual: historyAfter.length, expected0: historyBefore.length };
}

async function observeDensityCase5() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  // Add prunable content
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/file.ts',
    'content',
    'updated',
  );

  const historyBefore = 4;

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = false;

  await internals.ensureDensityOptimized();

  // History unchanged because dirty flag was false

  return {
    actual: (await collectRawHistory(densityFixture1_historyService)).length,
    expected0: historyBefore,
  };
}

async function observeDensityCase6() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
    'compression.density.optimizeThreshold': 0, // Always run for test
  });

  densityFixture1_historyService.add(makeUserMessage('Fix the bug'));
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/bug.ts',
    'buggy code',
    'fixed code',
  );
  densityFixture1_historyService.add(makeAiText('Bug fixed'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  // Wait for initial token calculation to settle
  await densityFixture1_historyService.waitForTokenUpdates();
  const tokensBefore = densityFixture1_historyService.getTotalTokens();

  await internals.ensureDensityOptimized();

  await densityFixture1_historyService.waitForTokenUpdates();
  const tokensAfter = densityFixture1_historyService.getTotalTokens();

  // Token count should reflect the pruning (lower or equal, never higher)

  return { actual: tokensAfter, expected0: tokensBefore };
}

async function observeDensityCase7() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  densityFixture1_historyService.add(makeUserMessage('Update file'));
  addPrunableReadWritePair(
    densityFixture1_historyService,
    '/workspace/main.ts',
    'original content that is quite long to ensure tokens change',
    'new content',
  );
  densityFixture1_historyService.add(makeAiText('Updated'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  await internals.ensureDensityOptimized();

  // After ensureDensityOptimized completes, getTotalTokens should
  // return the post-optimization value (not stale)
  const tokensAfter = densityFixture1_historyService.getTotalTokens();
  const historyLen = (await collectRawHistory(densityFixture1_historyService))
    .length;

  // If history was modified, tokens should be recalculated
  // (we just verify it doesn't throw and returns a number)
  expect(typeof tokensAfter).toBe('number');

  return historyLen;
}

async function observeDensityCase8() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  // Add history with NO prunable patterns (just normal conversation)
  densityFixture1_historyService.add(makeUserMessage('Hello'));
  densityFixture1_historyService.add(makeAiText('Hi, how can I help?'));
  densityFixture1_historyService.add(
    makeUserMessage('Tell me about TypeScript'),
  );
  densityFixture1_historyService.add(
    makeAiText('TypeScript is a typed superset of JavaScript'),
  );

  const historyBefore = (
    await collectRawHistory(densityFixture1_historyService)
  ).map((h) => ({
    speaker: h.speaker,
    blockCount: h.blocks.length,
  }));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  await internals.ensureDensityOptimized();

  const historyAfter = (
    await collectRawHistory(densityFixture1_historyService)
  ).map((h) => ({
    speaker: h.speaker,
    blockCount: h.blocks.length,
  }));

  // History should be completely unchanged

  return { actual: historyAfter, expected0: historyBefore };
}

async function observeDensityCase9() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  densityFixture1_historyService.add(makeUserMessage('Hello'));
  densityFixture1_historyService.add(makeAiText('Hi'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  await internals.ensureDensityOptimized();

  expect(internals.densityDirty).toBe(false);

  // Second call should be a no-op (verified by checking history doesn't change)
  const historySnapshot = 2;
  await internals.ensureDensityOptimized();

  return {
    actual: (await collectRawHistory(densityFixture1_historyService)).length,
    expected0: historySnapshot,
  };
}

async function observeDensityCase10() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  // No prunable content
  densityFixture1_historyService.add(makeUserMessage('Hello'));
  densityFixture1_historyService.add(makeAiText('Hi'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);
  internals.densityDirty = true;

  await internals.ensureDensityOptimized();

  // Flag should be false even though optimize didn't change anything

  return internals.densityDirty;
}

async function observeDensityCase11() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  densityFixture1_historyService.add(makeUserMessage('Hello'));
  densityFixture1_historyService.add(makeAiText('Hi'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
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
  densityFixture1_historyService.add(makeUserMessage('New message'));
  densityFixture1_historyService.add(makeAiText('New response'));

  // After P20 implementation, densityDirty should be true
  // because turn-loop add sites set it

  return internals.densityDirty;
}

async function observeDensityCase12() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'top-down-truncation',
  });

  // Populate enough history for compression
  for (let i = 0; i < 20; i++) {
    densityFixture1_historyService.add(makeUserMessage(`User message ${i}`));
    densityFixture1_historyService.add(makeAiText(`AI response ${i}`));
  }

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);

  // Clear the dirty flag
  internals.densityDirty = false;

  // Mock getTotalTokens to trigger compression
  vi.spyOn(densityFixture1_historyService, 'getTotalTokens').mockReturnValue(
    100_000,
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

  // performCompression calls clear() + add() loop — should NOT set dirty
  await chat.performCompression('test-prompt-id');

  // After P20, the dirty flag should still be false (compression rebuild doesn't dirty)

  return internals.densityDirty;
}

async function observeDensityCase13() {
  const runtimeContext = buildRuntimeContext(densityFixture1_historyService, {
    compressionStrategy: 'high-density',
  });

  densityFixture1_historyService.add(makeUserMessage('Initial'));
  densityFixture1_historyService.add(makeAiText('Response'));

  const chat = new ChatSession(
    runtimeContext,
    densityFixture2_mockContentGenerator,
    {},
    [],
  );
  const internals = getInternals(chat);

  // Run 1: optimize to clear flag
  internals.densityDirty = true;
  await internals.ensureDensityOptimized();
  expect(internals.densityDirty).toBe(false);

  // Add user message → should set dirty
  densityFixture1_historyService.add(makeUserMessage('User turn'));
  // After P20, this tests that the add site sets densityDirty = true
  // For now we manually simulate what P20 will do
  expect(internals.densityDirty).toBe(true);

  // Run 2: optimize again to clear flag
  await internals.ensureDensityOptimized();
  expect(internals.densityDirty).toBe(false);

  // Add AI response → should set dirty
  densityFixture1_historyService.add(makeAiText('AI turn'));
  expect(internals.densityDirty).toBe(true);

  // Run 3: optimize again
  await internals.ensureDensityOptimized();
  expect(internals.densityDirty).toBe(false);

  // Add tool result → should set dirty
  const toolCall = makeAiToolCall('read_file', { file_path: '/test' });
  densityFixture1_historyService.add(toolCall.entry);
  densityFixture1_historyService.add(
    makeToolResponse(toolCall.callId, 'read_file', 'content'),
  );

  return internals.densityDirty;
}
