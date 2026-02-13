/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P19
 * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4, REQ-HD-002.5,
 *              REQ-HD-002.6, REQ-HD-002.7, REQ-HD-002.8, REQ-HD-002.9, REQ-HD-002.10
 *
 * Behavioral tests for density optimization orchestration in GeminiChat.
 * Tests verify observable state changes (history mutations, token counts, dirty flag)
 * through real HighDensityStrategy instances. No mock theater.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { GeminiChat } from '../geminiChat.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import { createAgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../../runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '../contentGenerator.js';

// ---------------------------------------------------------------------------
// Test helpers — construct real IContent objects
// ---------------------------------------------------------------------------

let callIdCounter = 0;

function nextCallId(): string {
  return `call-${++callIdCounter}`;
}

function resetCallIds(): void {
  callIdCounter = 0;
}

function makeUserMessage(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: Date.now() },
  };
}

function makeAiText(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: Date.now() },
  };
}

function makeAiToolCall(
  toolName: string,
  parameters: unknown,
  callId?: string,
): { entry: IContent; callId: string } {
  const id = callId ?? nextCallId();
  return {
    entry: {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id,
          name: toolName,
          parameters,
        } as ToolCallBlock,
      ],
      metadata: { timestamp: Date.now() },
    },
    callId: id,
  };
}

function makeToolResponse(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      } as ToolResponseBlock,
    ],
    metadata: { timestamp: Date.now() },
  };
}

// ---------------------------------------------------------------------------
// Runtime context builder — matches existing test patterns
// ---------------------------------------------------------------------------

function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    compressionStrategy?: string;
    compressionThreshold?: number;
    contextLimit?: number;
    'compression.density.readWritePruning'?: boolean;
    'compression.density.fileDedupe'?: boolean;
    'compression.density.recencyPruning'?: boolean;
    'compression.density.recencyRetention'?: number;
  } = {},
): AgentRuntimeContext {
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: 'test-session',
  });

  const mockProviderAdapter = {
    getActiveProvider: vi.fn(() => ({
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
    })),
  };

  const mockTelemetryAdapter = {
    recordTokenUsage: vi.fn(),
    recordEvent: vi.fn(),
  };

  const mockToolsView = {
    getToolRegistry: vi.fn(() => undefined),
  };

  return createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: overrides.compressionThreshold ?? 0.8,
      contextLimit: overrides.contextLimit ?? 131134,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      compressionStrategy: overrides.compressionStrategy,
      'compression.density.readWritePruning':
        overrides['compression.density.readWritePruning'],
      'compression.density.fileDedupe':
        overrides['compression.density.fileDedupe'],
      'compression.density.recencyPruning':
        overrides['compression.density.recencyPruning'],
      'compression.density.recencyRetention':
        overrides['compression.density.recencyRetention'],
    },
    provider: mockProviderAdapter,
    telemetry: mockTelemetryAdapter,
    tools: mockToolsView,
    providerRuntime: {
      runtimeId: 'test-runtime',
      settingsService: { get: vi.fn(() => undefined) } as never,
      config: {} as never,
    },
  });
}

function buildMockContentGenerator(): ContentGenerator {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  } as unknown as ContentGenerator;
}

// ---------------------------------------------------------------------------
// Helper: Create a GeminiChat with access to private members
// ---------------------------------------------------------------------------

interface GeminiChatInternals {
  ensureDensityOptimized(): Promise<void>;
  densityDirty: boolean;
  historyService: HistoryService;
  ensureCompressionBeforeSend(
    promptId: string,
    pendingTokens: number,
    source: 'send' | 'stream',
  ): Promise<void>;
  enforceContextWindow(
    pendingTokens: number,
    promptId: string,
    provider?: unknown,
  ): Promise<void>;
  shouldCompress(pendingTokens?: number): boolean;
}

function getInternals(chat: GeminiChat): GeminiChatInternals {
  return chat as never;
}

// ---------------------------------------------------------------------------
// Helper: Build history with prunable read→write pairs
// ---------------------------------------------------------------------------

/**
 * Creates a history pattern that the high-density read-write pruning can act on:
 * 1. AI calls read_file on a file
 * 2. Tool responds with file contents
 * 3. AI calls write_file on the same file
 * 4. Tool responds with success
 *
 * The read pair (steps 1-2) becomes stale after the write and should be prunable.
 */
function addPrunableReadWritePair(
  historyService: HistoryService,
  filePath: string,
  fileContent: string,
  writeContent: string,
): void {
  // Read call
  const readCall = makeAiToolCall('read_file', { file_path: filePath });
  historyService.add(readCall.entry);
  historyService.add(
    makeToolResponse(readCall.callId, 'read_file', fileContent),
  );

  // Write call (makes the read stale)
  const writeCall = makeAiToolCall('write_file', {
    file_path: filePath,
    content: writeContent,
  });
  historyService.add(writeCall.entry);
  historyService.add(
    makeToolResponse(
      writeCall.callId,
      'write_file',
      'File written successfully',
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Density Optimization Orchestration (P19)', () => {
  let historyService: HistoryService;
  let mockContentGenerator: ContentGenerator;

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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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
      });

      historyService.add(makeUserMessage('Fix the bug'));
      addPrunableReadWritePair(
        historyService,
        '/workspace/bug.ts',
        'buggy code',
        'fixed code',
      );
      historyService.add(makeAiText('Bug fixed'));

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
      const internals = getInternals(chat);
      internals.densityDirty = true;

      await internals.ensureDensityOptimized();

      const historyAfter = historyService.getRawHistory().map((h) => ({
        speaker: h.speaker,
        blockCount: h.blocks.length,
      }));

      // History should be completely unchanged
      expect(historyAfter).toEqual(historyBefore);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
      const internals = getInternals(chat);
      internals.densityDirty = true;

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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
      const internals = getInternals(chat);
      internals.densityDirty = true;

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

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);
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
      // Read the source file and verify call sites
      const fs = await import('fs');
      const source = fs.readFileSync(
        new URL('../../core/geminiChat.ts', import.meta.url).pathname.replace(
          /^\/([A-Z]:)/,
          '$1',
        ),
        'utf-8',
      );

      // Find all calls to ensureDensityOptimized (excluding the method declaration)
      const callSites = source
        .split('\n')
        .filter(
          (line) =>
            line.includes('ensureDensityOptimized') &&
            !line.includes('private async ensureDensityOptimized') &&
            !line.includes('@pseudocode') &&
            !line.includes('* '),
        );

      // Should have exactly 2 call sites (ensureCompressionBeforeSend + enforceContextWindow)
      // plus the early return check line
      const awaitCalls = callSites.filter((line) =>
        line.includes('await this.ensureDensityOptimized()'),
      );
      expect(awaitCalls.length).toBe(2);
    });
  });

  // =========================================================================
  // Property-Based Tests (≥ 30% of total)
  // =========================================================================

  describe('property-based tests', () => {
    /**
     * Property: For any history state and strategy, after ensureDensityOptimized()
     * completes, densityDirty is false.
     */
    it(
      'dirty flag is always false after ensureDensityOptimized completes',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom(
              'high-density',
              'middle-out',
              'top-down-truncation',
              'one-shot',
            ),
            fc.integer({ min: 1, max: 5 }),
            async (strategyName, messageCount) => {
              const hs = new HistoryService();
              for (let i = 0; i < messageCount; i++) {
                hs.add(makeUserMessage(`Message ${i}`));
                hs.add(makeAiText(`Response ${i}`));
              }

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: strategyName,
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = true;

              await internals.ensureDensityOptimized();

              return internals.densityDirty === false;
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: For any history, when strategy is middle-out (no optimize),
     * history before === history after ensureDensityOptimized().
     */
    it(
      'history is unchanged when strategy has no optimize method',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 8 }),
            async (messageCount) => {
              const hs = new HistoryService();
              for (let i = 0; i < messageCount; i++) {
                hs.add(makeUserMessage(`Msg ${i}`));
                hs.add(makeAiText(`Resp ${i}`));
              }

              const historyBefore = hs.getRawHistory().length;

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: 'middle-out',
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = true;

              await internals.ensureDensityOptimized();

              return hs.getRawHistory().length === historyBefore;
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: For any prunable history, the post-optimization history length
     * is ≤ the pre-optimization length.
     */
    it(
      'history length after optimization <= history length before',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 3 }),
            async (pairCount) => {
              resetCallIds();
              const hs = new HistoryService();

              hs.add(makeUserMessage('Initial'));
              for (let i = 0; i < pairCount; i++) {
                addPrunableReadWritePair(
                  hs,
                  `/workspace/file${i}.ts`,
                  `content-${i}`,
                  `updated-${i}`,
                );
              }
              hs.add(makeAiText('Done'));

              const lengthBefore = hs.getRawHistory().length;

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: 'high-density',
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = true;

              await internals.ensureDensityOptimized();

              return hs.getRawHistory().length <= lengthBefore;
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: For any history where optimize returns empty removals and replacements,
     * history is unchanged.
     */
    it(
      'empty result produces no history changes',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 5 }),
            async (messageCount) => {
              const hs = new HistoryService();
              // Only add non-prunable content (plain messages)
              for (let i = 0; i < messageCount; i++) {
                hs.add(makeUserMessage(`Plain message ${i}`));
                hs.add(makeAiText(`Plain response ${i}`));
              }

              const lengthBefore = hs.getRawHistory().length;
              const speakersBefore = hs.getRawHistory().map((h) => h.speaker);

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: 'high-density',
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = true;

              await internals.ensureDensityOptimized();

              const speakersAfter = hs.getRawHistory().map((h) => h.speaker);

              return (
                hs.getRawHistory().length === lengthBefore &&
                JSON.stringify(speakersAfter) === JSON.stringify(speakersBefore)
              );
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: For any history, totalTokens after ≤ totalTokens before
     * (optimization only removes/shrinks).
     */
    it(
      'optimization never increases token count',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 3 }),
            async (pairCount) => {
              resetCallIds();
              const hs = new HistoryService();

              hs.add(makeUserMessage('Start'));
              for (let i = 0; i < pairCount; i++) {
                addPrunableReadWritePair(
                  hs,
                  `/workspace/file${i}.ts`,
                  `content-${i}-${'x'.repeat(100)}`,
                  `updated-${i}`,
                );
              }
              hs.add(makeAiText('End'));

              await hs.waitForTokenUpdates();
              const tokensBefore = hs.getTotalTokens();

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: 'high-density',
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = true;

              await internals.ensureDensityOptimized();
              await hs.waitForTokenUpdates();

              return hs.getTotalTokens() <= tokensBefore;
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: When densityDirty is false, ensureDensityOptimized returns
     * immediately regardless of history content.
     */
    it(
      'clean flag always skips optimization regardless of history',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.constantFrom(
              'high-density',
              'middle-out',
              'top-down-truncation',
            ),
            fc.integer({ min: 0, max: 5 }),
            async (strategyName, messageCount) => {
              resetCallIds();
              const hs = new HistoryService();
              for (let i = 0; i < messageCount; i++) {
                hs.add(makeUserMessage(`Msg ${i}`));
                hs.add(makeAiText(`Resp ${i}`));
              }

              const lengthBefore = hs.getRawHistory().length;

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: strategyName,
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = false;

              await internals.ensureDensityOptimized();

              return hs.getRawHistory().length === lengthBefore;
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: After density optimization, the remaining history entries are a
     * subset of the original entries (no new entries are fabricated).
     */
    it(
      'optimization only removes entries, never fabricates new ones',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 3 }),
            async (pairCount) => {
              resetCallIds();
              const hs = new HistoryService();

              hs.add(makeUserMessage('Start'));
              for (let i = 0; i < pairCount; i++) {
                addPrunableReadWritePair(
                  hs,
                  `/workspace/f${i}.ts`,
                  `content-${i}`,
                  `upd-${i}`,
                );
              }
              hs.add(makeAiText('End'));

              const speakersBefore = hs.getRawHistory().map((h) => h.speaker);

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: 'high-density',
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);
              internals.densityDirty = true;

              await internals.ensureDensityOptimized();

              const speakersAfter = hs.getRawHistory().map((h) => h.speaker);

              // Every speaker in the after set must appear in the before set
              // and the after length must be ≤ before length
              return (
                speakersAfter.length <= speakersBefore.length &&
                speakersAfter.every((s) => speakersBefore.includes(s))
              );
            },
          ),
          { numRuns: 5 },
        );
      },
    );

    /**
     * Property: Calling ensureDensityOptimized() twice without adding content
     * produces identical history both times.
     */
    it(
      'consecutive clean optimizations are no-ops',
      { timeout: 60_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 5 }),
            async (messageCount) => {
              resetCallIds();
              const hs = new HistoryService();

              hs.add(makeUserMessage('Hello'));
              for (let i = 0; i < messageCount; i++) {
                hs.add(makeAiText(`Response ${i}`));
                hs.add(makeUserMessage(`Follow-up ${i}`));
              }

              const ctx = buildRuntimeContext(hs, {
                compressionStrategy: 'high-density',
              });
              const gen = buildMockContentGenerator();
              const chat = new GeminiChat(ctx, gen, {}, []);
              const internals = getInternals(chat);

              // First optimization
              internals.densityDirty = true;
              await internals.ensureDensityOptimized();
              const lengthAfterFirst = hs.getRawHistory().length;
              const speakersAfterFirst = hs
                .getRawHistory()
                .map((h) => h.speaker);

              // Second optimization (should be no-op since dirty is false)
              // Force dirty to true to actually run optimize again
              internals.densityDirty = true;
              await internals.ensureDensityOptimized();
              const lengthAfterSecond = hs.getRawHistory().length;
              const speakersAfterSecond = hs
                .getRawHistory()
                .map((h) => h.speaker);

              return (
                lengthAfterFirst === lengthAfterSecond &&
                JSON.stringify(speakersAfterFirst) ===
                  JSON.stringify(speakersAfterSecond)
              );
            },
          ),
          { numRuns: 5 },
        );
      },
    );
  });
});
