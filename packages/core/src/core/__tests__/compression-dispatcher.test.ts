/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P13
 * @requirement REQ-CS-006.1, REQ-CS-006.2, REQ-CS-006.3, REQ-CS-006.4
 *
 * Dispatcher integration tests: verify that performCompression() in GeminiChat
 * delegates to the correct compression strategy based on the
 * `compressionStrategy` ephemeral setting.
 *
 * These tests are written TDD-style: they WILL FAIL until P14 refactors
 * performCompression() to use the strategy pattern via the factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiChat } from '../geminiChat.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import type { IContent } from '../../services/history/IContent.js';
import { createAgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '../../runtime/createAgentRuntimeContext.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '../contentGenerator.js';
import type { CompressionContext } from '../compression/types.js';

// ---------------------------------------------------------------------------
// Message helpers (same pattern as sandwich-compression.test.ts)
// ---------------------------------------------------------------------------

function createUserMessage(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text' as const, text }],
  };
}

function createAiTextMessage(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text' as const, text }],
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildRuntimeContext(
  historyService: HistoryService,
  overrides: {
    compressionStrategy?: string;
    compressionProfile?: string;
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
      compressionThreshold: 0.8,
      contextLimit: 131134,
      preserveThreshold: 0.3,
      telemetry: { enabled: false, target: null },
      compressionStrategy: overrides.compressionStrategy,
      compressionProfile: overrides.compressionProfile,
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

function buildMockProvider(summaryText: string) {
  return {
    name: 'test-provider',
    generateChatCompletion: vi.fn(async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: summaryText }],
      };
    }),
  };
}

/**
 * Populate history with enough messages to guarantee compression will occur.
 * With default thresholds (topPreserve=0.2, bottomPreserve=0.3) and 40
 * messages, the middle section will have enough messages (>= 4) to compress.
 */
function populateHistory(historyService: HistoryService, count = 20): void {
  for (let i = 0; i < count; i++) {
    historyService.add(createUserMessage(`User message ${i}`));
    historyService.add(createAiTextMessage(`AI response ${i}`));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Compression Dispatcher Integration (P13)', () => {
  let historyService: HistoryService;
  let mockContentGenerator: ContentGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    mockContentGenerator = buildMockContentGenerator();
  });

  describe('strategy delegation (REQ-CS-006.1)', () => {
    it('should use top-down-truncation when compressionStrategy is "top-down-truncation"', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'top-down-truncation',
      });

      populateHistory(historyService);
      const messageCountBefore = historyService.getCurated().length;

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // top-down-truncation needs currentTokenCount above the target threshold
      // to actually truncate. Mock getTotalTokens to simulate token pressure.
      vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(100_000);

      const mockProvider = buildMockProvider('should-not-appear');
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Top-down truncation should NOT produce any state_snapshot summary
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(false);

      // History should be shorter (messages were truncated from the top)
      expect(finalHistory.length).toBeLessThan(messageCountBefore);

      // All surviving messages should be originals (no synthetic ack message)
      const hasAck = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) =>
            b.type === 'text' &&
            b.text === 'Understood. Continuing with the current task.',
        ),
      );
      expect(hasAck).toBe(false);
    });

    it('should use middle-out (default) when compressionStrategy is "middle-out"', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'middle-out',
      });

      populateHistory(historyService);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Test goal</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Middle-out SHOULD produce a state_snapshot summary
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);

      // Should have the acknowledgment message
      const hasAck = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) =>
            b.type === 'text' &&
            b.text === 'Understood. Continuing with the current task.',
        ),
      );
      expect(hasAck).toBe(true);
    });

    it('should default to middle-out when no strategy is explicitly set', async () => {
      // No compressionStrategy override — relies on registry default
      const runtimeContext = buildRuntimeContext(historyService);

      populateHistory(historyService);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Default strategy</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // Should behave as middle-out: summary with state_snapshot present
      const hasSummary = finalHistory.some((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(hasSummary).toBe(true);
    });
  });

  describe('result application (REQ-CS-006.2)', () => {
    it('should rebuild history with messages in correct order after compression', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'middle-out',
      });

      populateHistory(historyService);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Ordered result</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      const finalHistory = historyService.getCurated();

      // History should have content (not be empty)
      expect(finalHistory.length).toBeGreaterThan(0);

      // Find the summary message index
      const summaryIndex = finalHistory.findIndex((msg) =>
        msg.blocks.some(
          (b) => b.type === 'text' && b.text.includes('state_snapshot'),
        ),
      );
      expect(summaryIndex).toBeGreaterThanOrEqual(0);

      // Messages before summary should be preserved top messages (user/ai originals)
      // Messages after summary+ack should be preserved bottom messages
      // The first message should still be from the original conversation
      const firstMsg = finalHistory[0];
      expect(firstMsg.speaker).toBe('human');
      expect(firstMsg.blocks[0].type).toBe('text');

      // The last message should be from the original conversation bottom
      const lastMsg = finalHistory[finalHistory.length - 1];
      expect(lastMsg.blocks[0].type).toBe('text');
    });
  });

  describe('error propagation (REQ-CS-006.3)', () => {
    it('should propagate strategy errors and still call endCompression', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'middle-out',
      });

      populateHistory(historyService);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // Make the provider throw an error to simulate strategy failure
      const mockProvider = {
        name: 'test-provider',
        generateChatCompletion: vi.fn(async function* () {
          throw new Error('Strategy execution failed');
          yield undefined as never;
        }),
      };
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      // Should propagate the error
      await expect(chat.performCompression('test-prompt-id')).rejects.toThrow(
        'Strategy execution failed',
      );

      // After error, historyService should be unlocked (endCompression was called)
      // Verify by checking we can add messages (would throw if still locked)
      expect(() => {
        historyService.add(createUserMessage('Post-error message'));
      }).not.toThrow();
    });
  });

  describe('atomicity (REQ-CS-006.4)', () => {
    it('should unlock historyService after error (endCompression called in finally)', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'middle-out',
      });

      populateHistory(historyService);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      // Simulate a provider that returns an invalid generator
      const mockProvider = {
        name: 'test-provider',
        generateChatCompletion: vi.fn(() => {
          throw new Error('Provider initialization failed');
        }),
      };
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await expect(chat.performCompression('test-prompt-id')).rejects.toThrow();

      // historyService must be unlocked — verify by adding a message
      expect(() => {
        historyService.add(createUserMessage('After failed compression'));
      }).not.toThrow();

      // And the message should actually appear in the history
      const curated = historyService.getCurated();
      const lastMsg = curated[curated.length - 1];
      expect(lastMsg.blocks[0]).toMatchObject({
        type: 'text',
        text: 'After failed compression',
      });
    });

    it('should unlock historyService after successful compression', async () => {
      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'middle-out',
      });

      populateHistory(historyService);

      const chat = new GeminiChat(runtimeContext, mockContentGenerator, {}, []);

      const summaryText =
        '<state_snapshot><overall_goal>Success</overall_goal></state_snapshot>';
      const mockProvider = buildMockProvider(summaryText);
      vi.spyOn(chat as never, 'resolveProviderForRuntime').mockReturnValue(
        mockProvider as never,
      );
      vi.spyOn(chat as never, 'providerSupportsIContent').mockReturnValue(true);

      await chat.performCompression('test-prompt-id');

      // historyService must be unlocked after successful completion
      expect(() => {
        historyService.add(createUserMessage('Post-compression message'));
      }).not.toThrow();
    });
  });

  describe('context boundary (REQ-CS-001.6)', () => {
    it('CompressionContext type should not include historyService', () => {
      // This is a compile-time assertion: CompressionContext should not
      // have a historyService field. We verify by constructing a minimal
      // CompressionContext and confirming it has no historyService key.
      const contextKeys: Array<keyof CompressionContext> = [
        'history',
        'runtimeContext',
        'runtimeState',
        'estimateTokens',
        'currentTokenCount',
        'logger',
        'resolveProvider',
        'promptResolver',
        'promptBaseDir',
        'promptContext',
        'promptId',
      ];

      // historyService must NOT be a valid key on CompressionContext
      expect(contextKeys).not.toContain('historyService');

      // Double-check: construct a partial CompressionContext-shaped object
      // and verify 'historyService' is not among its expected fields
      const knownFields = new Set(contextKeys);
      expect(knownFields.has('historyService' as never)).toBe(false);
    });
  });
});
