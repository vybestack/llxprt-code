/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P07
 * @requirement REQ-CS-003.1, REQ-CS-003.2, REQ-CS-003.3
 * @requirement REQ-CS-003.4, REQ-CS-003.5
 *
 * Behavioral tests for the TopDownTruncationStrategy compression strategy.
 *
 * This strategy removes the oldest messages until the token count drops
 * below a target (compressionThreshold × contextLimit × 0.6). It never
 * calls the LLM — a throwing provider proves this. Results contain only
 * surviving messages (no summary, no ack).
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';
import type { CompressionContext } from './types.js';
import type { IProvider } from '../../providers/IProvider.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import type { Logger } from '../logger.js';
import type { PromptResolver } from '../../prompt-config/prompt-resolver.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';

// ---------------------------------------------------------------------------
// Helpers — build realistic IContent messages
// ---------------------------------------------------------------------------

function humanMsg(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiTextMsg(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function aiToolCallMsg(
  ...calls: Array<{ id: string; name: string }>
): IContent {
  return {
    speaker: 'ai',
    blocks: calls.map((c) => ({
      type: 'tool_call' as const,
      id: c.id,
      name: c.name,
      parameters: {},
    })),
  };
}

function toolResponseMsg(
  callId: string,
  toolName: string,
  result: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response' as const,
        callId,
        toolName,
        result,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Throwing provider — proves no LLM calls are made
// ---------------------------------------------------------------------------

function createThrowingProvider(): IProvider {
  return {
    name: 'throwing-provider',
    getModels: async () => [],
    getDefaultModel: () => 'fake-model',
    getServerTools: () => [],
    invokeServerTool: async () => {
      throw new Error('LLM should never be called by top-down-truncation');
    },
    async *generateChatCompletion() {
      throw new Error('LLM should never be called by top-down-truncation');
      yield undefined as never;
    },
  } as unknown as IProvider;
}

// ---------------------------------------------------------------------------
// Stub logger — no-op, satisfies Logger type
// ---------------------------------------------------------------------------

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
} as unknown as Logger;

// ---------------------------------------------------------------------------
// Build a CompressionContext for testing
// ---------------------------------------------------------------------------

function buildContext(
  overrides: Partial<{
    history: IContent[];
    compressionThreshold: number;
    contextLimit: number;
    currentTokenCount: number;
    estimateTokens: (contents: readonly IContent[]) => Promise<number>;
  }> = {},
): CompressionContext {
  const throwingProvider = createThrowingProvider();
  const contextLimit = overrides.contextLimit ?? 10000;
  const compressionThreshold = overrides.compressionThreshold ?? 0.8;

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: 'test-session',
    updatedAt: Date.now(),
  };

  const runtimeContext = {
    state: runtimeState,
    ephemerals: {
      compressionThreshold: () => compressionThreshold,
      contextLimit: () => contextLimit,
      preserveThreshold: () => 0.2,
      topPreserveThreshold: () => 0.2,
      toolFormatOverride: () => undefined,
      reasoning: {
        enabled: () => false,
        includeInContext: () => false,
        includeInResponse: () => false,
        format: () => 'native' as const,
        stripFromContext: () => 'none' as const,
        effort: () => undefined,
        maxTokens: () => undefined,
        adaptiveThinking: () => undefined,
      },
    },
  } as unknown as AgentRuntimeContext;

  const promptResolver = {
    resolveFile: () => ({ found: false, path: null, source: null }),
  } as unknown as PromptResolver;

  // Default estimateTokens: 100 tokens per message
  const estimateTokens =
    overrides.estimateTokens ??
    (async (contents: readonly IContent[]) => contents.length * 100);

  return {
    history: overrides.history ?? [],
    runtimeContext,
    runtimeState,
    estimateTokens,
    currentTokenCount: overrides.currentTokenCount ?? 5000,
    logger: noopLogger,
    resolveProvider: () => throwingProvider,
    promptResolver,
    promptBaseDir: '/tmp/test-prompts',
    promptContext: {
      provider: 'test-provider',
      model: 'test-model',
    },
    promptId: 'test-prompt',
  };
}

/**
 * Generate a conversation history of alternating human/ai messages.
 */
function generateHistory(count: number): IContent[] {
  const messages: IContent[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      messages.push(humanMsg(`user message ${i}`));
    } else {
      messages.push(aiTextMsg(`ai response ${i}`));
    }
  }
  return messages;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('TopDownTruncationStrategy', () => {
  // -----------------------------------------------------------------------
  // @requirement REQ-CS-003.1 — Interface contract
  // -----------------------------------------------------------------------

  describe('interface contract', () => {
    it('has name "top-down-truncation"', () => {
      const strategy = new TopDownTruncationStrategy();
      expect(strategy.name).toBe('top-down-truncation');
    });

    it('reports requiresLLM as false', () => {
      const strategy = new TopDownTruncationStrategy();
      expect(strategy.requiresLLM).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // @requirement REQ-CS-003.2 — Removes oldest messages until under target
  // -----------------------------------------------------------------------

  describe('removes oldest messages until under target', () => {
    it('removes messages from the front until token count < target', async () => {
      // 10 messages, 100 tokens each = 1000 total
      // contextLimit=10000, compressionThreshold=0.8
      // target = 0.8 * 10000 * 0.6 = 4800
      // currentTokenCount=5000 (above target)
      // After removing msg 0 → 900 tokens (9 msgs), which is < 4800 → stop
      // But the strategy removes based on re-estimating after removal.
      // With 100 tokens/msg, need to get below 4800:
      // 10 msgs = 1000 tokens. Already < 4800, but currentTokenCount=5000.
      //
      // Let's use a scenario that clearly triggers truncation:
      // 20 messages, 500 tokens each = 10000 total
      // target = 0.8 * 10000 * 0.6 = 4800
      // currentTokenCount = 10000
      // Need to remove until remaining < 4800 → need ≤ 9 msgs (4500 tokens)
      // So 11 messages removed, 9 survive.
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        currentTokenCount: 10000,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // 9 messages × 500 = 4500 < 4800, 10 messages × 500 = 5000 > 4800
      expect(result.newHistory.length).toBeLessThanOrEqual(10);
      expect(result.newHistory.length).toBeGreaterThanOrEqual(2);

      // Surviving messages come from the END of the original history
      const kept = result.newHistory.length;
      for (let i = 0; i < kept; i++) {
        expect(result.newHistory[i]).toBe(history[history.length - kept + i]);
      }
    });

    it('returns all messages when already under target', async () => {
      // 5 messages, 100 tokens each = 500 total
      // target = 0.8 * 10000 * 0.6 = 4800
      // currentTokenCount = 500 (already under)
      const history = generateHistory(5);
      const ctx = buildContext({
        history,
        currentTokenCount: 500,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 100,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(result.newHistory[i]).toBe(history[i]);
      }
    });

    it('removes specific number of messages to get under target', async () => {
      // 10 messages, 1000 tokens each = 10000 total
      // target = 0.8 * 20000 * 0.6 = 9600
      // currentTokenCount = 10000
      // Need to get below 9600: 9 msgs = 9000 < 9600 → remove 1
      const history = generateHistory(10);
      const ctx = buildContext({
        history,
        currentTokenCount: 10000,
        contextLimit: 20000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 1000,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // Should keep 9 messages (9000 < 9600)
      expect(result.newHistory).toHaveLength(9);
      // They should be the last 9 from the original
      for (let i = 0; i < 9; i++) {
        expect(result.newHistory[i]).toBe(history[i + 1]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // @requirement REQ-CS-003.3 — Never calls LLM
  // -----------------------------------------------------------------------

  describe('never calls LLM', () => {
    it('does not call the LLM even when many messages are removed', async () => {
      // The throwing provider will cause a test failure if called.
      const history = generateHistory(30);
      const ctx = buildContext({
        history,
        currentTokenCount: 15000,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // If we got here without throwing, the LLM was not called
      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.metadata.strategyUsed).toBe('top-down-truncation');
    });
  });

  // -----------------------------------------------------------------------
  // @requirement REQ-CS-003.4 — Returns ONLY surviving messages
  // -----------------------------------------------------------------------

  describe('returns only surviving messages', () => {
    it('does not include summary or ack messages in result', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        currentTokenCount: 10000,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // Every message in newHistory should be a reference to an original message
      for (const msg of result.newHistory) {
        expect(history).toContain(msg);
      }

      // No message should be a summary or acknowledgment
      for (const msg of result.newHistory) {
        for (const block of msg.blocks) {
          if (block.type === 'text' && 'text' in block) {
            expect((block as { text: string }).text).not.toContain(
              'state_snapshot',
            );
            expect((block as { text: string }).text).not.toContain(
              'Understood. Continuing with the current task.',
            );
          }
        }
      }
    });

    it('surviving messages are contiguous from end of history', async () => {
      const history = generateHistory(16);
      const ctx = buildContext({
        history,
        currentTokenCount: 8000,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      const kept = result.newHistory.length;
      const startIndex = history.length - kept;
      for (let i = 0; i < kept; i++) {
        expect(result.newHistory[i]).toBe(history[startIndex + i]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // @requirement REQ-CS-003.5 — Keeps at least min(2, history.length)
  // -----------------------------------------------------------------------

  describe('minimum message preservation', () => {
    it('keeps at least 2 messages even when target is very low', async () => {
      // 10 messages, 10000 tokens each = 100000 total
      // target = 0.1 * 1000 * 0.6 = 60 tokens
      // Even removing all but 1 msg would be 10000 >> 60
      // Strategy should keep at least 2 messages
      const history = generateHistory(10);
      const ctx = buildContext({
        history,
        currentTokenCount: 100000,
        contextLimit: 1000,
        compressionThreshold: 0.1,
        estimateTokens: async (contents) => contents.length * 10000,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      expect(result.newHistory.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps the single message when history has only 1 message', async () => {
      const history = [humanMsg('only message')];
      const ctx = buildContext({
        history,
        currentTokenCount: 50000,
        contextLimit: 1000,
        compressionThreshold: 0.1,
        estimateTokens: async (contents) => contents.length * 50000,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // min(2, 1) = 1
      expect(result.newHistory).toHaveLength(1);
      expect(result.newHistory[0]).toBe(history[0]);
    });

    it('keeps both messages when history has exactly 2 messages', async () => {
      const history = [humanMsg('hello'), aiTextMsg('hi')];
      const ctx = buildContext({
        history,
        currentTokenCount: 50000,
        contextLimit: 1000,
        compressionThreshold: 0.1,
        estimateTokens: async (contents) => contents.length * 50000,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(2);
      expect(result.newHistory[0]).toBe(history[0]);
      expect(result.newHistory[1]).toBe(history[1]);
    });
  });

  // -----------------------------------------------------------------------
  // Tool-call boundary adjustment
  // -----------------------------------------------------------------------

  describe('tool-call boundary adjustment', () => {
    it('does not orphan tool responses when truncating', async () => {
      // Place a tool call/response pair near the truncation boundary
      // History: [h0, ai1, ai_toolcall2, tool_resp3, h4, ai5, h6, ai7, h8, ai9]
      // If naive truncation removes first 4 messages, tool_resp at index 3
      // would be orphaned. Strategy should use adjustForToolCallBoundary.
      const history: IContent[] = [
        humanMsg('msg 0'), // 0
        aiTextMsg('msg 1'), // 1
        aiToolCallMsg({ id: 'c1', name: 'search' }), // 2
        toolResponseMsg('c1', 'search', 'found something'), // 3
        humanMsg('msg 4'), // 4
        aiTextMsg('msg 5'), // 5
        humanMsg('msg 6'), // 6
        aiTextMsg('msg 7'), // 7
        humanMsg('msg 8'), // 8
        aiTextMsg('msg 9'), // 9
      ];

      const ctx = buildContext({
        history,
        currentTokenCount: 5000,
        contextLimit: 5000,
        compressionThreshold: 0.8,
        // 500 tokens per message; target = 0.8 * 5000 * 0.6 = 2400
        // Need ≤ 4 messages (2000 < 2400), so remove 6 → keep last 4
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // Verify no orphaned tool responses: first message should not be a tool response
      if (result.newHistory.length > 0) {
        expect(result.newHistory[0].speaker).not.toBe('tool');
      }

      // If an AI message with tool calls is in the result, its responses must also be there
      for (let i = 0; i < result.newHistory.length; i++) {
        const msg = result.newHistory[i];
        if (msg.speaker === 'ai') {
          const toolCalls = msg.blocks.filter((b) => b.type === 'tool_call');
          for (const call of toolCalls) {
            const callId = (call as { id: string }).id;
            const hasResponse = result.newHistory.some(
              (m) =>
                m.speaker === 'tool' &&
                m.blocks.some(
                  (b) =>
                    b.type === 'tool_response' &&
                    'callId' in b &&
                    b.callId === callId,
                ),
            );
            expect(hasResponse).toBe(true);
          }
        }
      }
    });

    it('adjusts boundary past consecutive tool responses', async () => {
      // Multiple tool responses in a row — truncation should skip past all of them
      const history: IContent[] = [
        humanMsg('msg 0'), // 0
        aiToolCallMsg(
          { id: 'c1', name: 'search' },
          { id: 'c2', name: 'fetch' },
        ), // 1
        toolResponseMsg('c1', 'search', 'result1'), // 2
        toolResponseMsg('c2', 'fetch', 'result2'), // 3
        humanMsg('msg 4'), // 4
        aiTextMsg('msg 5'), // 5
        humanMsg('msg 6'), // 6
        aiTextMsg('msg 7'), // 7
        humanMsg('msg 8'), // 8
        aiTextMsg('msg 9'), // 9
        humanMsg('msg 10'), // 10
        aiTextMsg('msg 11'), // 11
      ];

      const ctx = buildContext({
        history,
        currentTokenCount: 6000,
        contextLimit: 6000,
        compressionThreshold: 0.8,
        // 500 tokens each; target = 0.8 * 6000 * 0.6 = 2880
        // Need ≤ 5 messages (2500 < 2880), remove 7 → keep last 5
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      // No tool responses should appear without their corresponding tool calls
      for (const msg of result.newHistory) {
        if (msg.speaker === 'tool') {
          const responseBlock = msg.blocks.find(
            (b) => b.type === 'tool_response',
          );
          if (responseBlock && 'callId' in responseBlock) {
            const callId = responseBlock.callId;
            const hasCall = result.newHistory.some(
              (m) =>
                m.speaker === 'ai' &&
                m.blocks.some(
                  (b) => b.type === 'tool_call' && 'id' in b && b.id === callId,
                ),
            );
            expect(hasCall).toBe(true);
          }
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  describe('metadata completeness', () => {
    it('populates all required metadata fields correctly', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        currentTokenCount: 10000,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 500,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.originalMessageCount).toBe(20);
      expect(result.metadata.compressedMessageCount).toBe(
        result.newHistory.length,
      );
      expect(result.metadata.strategyUsed).toBe('top-down-truncation');
      expect(result.metadata.llmCallMade).toBe(false);
    });

    it('reports correct counts when no truncation needed', async () => {
      const history = generateHistory(5);
      const ctx = buildContext({
        history,
        currentTokenCount: 100,
        contextLimit: 10000,
        compressionThreshold: 0.8,
        estimateTokens: async (contents) => contents.length * 20,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.originalMessageCount).toBe(5);
      expect(result.metadata.compressedMessageCount).toBe(5);
      expect(result.metadata.llmCallMade).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty history gracefully', async () => {
      const ctx = buildContext({
        history: [],
        currentTokenCount: 0,
      });

      const strategy = new TopDownTruncationStrategy();
      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(0);
      expect(result.metadata.originalMessageCount).toBe(0);
      expect(result.metadata.compressedMessageCount).toBe(0);
      expect(result.metadata.llmCallMade).toBe(false);
    });
  });
});
