/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 * @requirement REQ-CS-002.1, REQ-CS-002.2, REQ-CS-002.3, REQ-CS-002.4
 * @requirement REQ-CS-002.5, REQ-CS-002.6, REQ-CS-002.7, REQ-CS-002.8
 *
 * Behavioral tests for the MiddleOutStrategy compression strategy.
 * Extracted from the sandwich compression logic in geminiChat.ts.
 *
 * These tests verify the strategy's output structure and metadata — not
 * internal spy calls.  The "fake provider" returns a known summary so we
 * can assert on the assembled result, which is real behavioral verification.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';
import type { CompressionContext } from './types.js';
import type { IProvider } from '../../providers/IProvider.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import type { Logger } from '../logger.js';
import type { PromptResolver } from '../../prompt-config/prompt-resolver.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';

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
// Fake provider — returns a known summary from generateChatCompletion
// ---------------------------------------------------------------------------

const KNOWN_SUMMARY =
  '<state_snapshot>Compressed summary of the middle section</state_snapshot>';

function createFakeProvider(
  name: string,
  summaryText: string = KNOWN_SUMMARY,
): IProvider {
  return {
    name,
    getModels: async () => [],
    getDefaultModel: () => 'fake-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: summaryText }],
      };
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
    preserveThreshold: number;
    topPreserveThreshold: number;
    compressionThreshold: number;
    compressionProfile: string;
    resolveProvider: (profileName?: string) => IProvider;
    model: string;
    provider: string;
    currentTokenCount: number;
  }> = {},
): CompressionContext {
  const defaultProvider = createFakeProvider('default-provider');
  const resolveProvider = overrides.resolveProvider ?? (() => defaultProvider);

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: overrides.provider ?? 'test-provider',
    model: overrides.model ?? 'test-model',
    sessionId: 'test-session',
    updatedAt: Date.now(),
  };

  const runtimeContext = {
    state: runtimeState,
    ephemerals: {
      compressionThreshold: () => overrides.compressionThreshold ?? 0.8,
      contextLimit: () => 100000,
      preserveThreshold: () => overrides.preserveThreshold ?? 0.2,
      topPreserveThreshold: () => overrides.topPreserveThreshold ?? 0.2,
      compressionProfile: () => overrides.compressionProfile,
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

  return {
    history: overrides.history ?? [],
    runtimeContext,
    runtimeState,
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: overrides.currentTokenCount ?? 5000,
    logger: noopLogger,
    resolveProvider,
    promptResolver,
    promptBaseDir: '/tmp/test-prompts',
    promptContext: {
      provider: overrides.provider ?? 'test-provider',
      model: overrides.model ?? 'test-model',
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

describe('MiddleOutStrategy', () => {
  // -----------------------------------------------------------------------
  // 10. Interface contract
  // -----------------------------------------------------------------------

  describe('interface contract', () => {
    it('has name "middle-out"', () => {
      const strategy = new MiddleOutStrategy();
      expect(strategy.name).toBe('middle-out');
    });

    it('reports requiresLLM as true', () => {
      const strategy = new MiddleOutStrategy();
      expect(strategy.requiresLLM).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 1. Sandwich split — correct top/middle/bottom counts
  // -----------------------------------------------------------------------

  describe('sandwich split', () => {
    it('produces correct top/middle/bottom counts for 20 messages with default thresholds', async () => {
      // Default thresholds: topPreserveThreshold=0.2, preserveThreshold=0.2
      // 20 messages: topSplitIndex = ceil(20 * 0.2) = 4
      //              bottomSplitIndex = floor(20 * 0.8) = 16
      // Top: 0..3 (4 messages), Middle: 4..15 (12 messages), Bottom: 16..19 (4 messages)
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      // The result should contain:
      //   top (4) + humanSummary (1) + aiAck (1) + bottom (4) = 10
      expect(result.metadata.topPreserved).toBe(4);
      expect(result.metadata.bottomPreserved).toBe(4);
      expect(result.metadata.middleCompressed).toBe(12);
      expect(result.metadata.originalMessageCount).toBe(20);
      expect(result.newHistory).toHaveLength(10);
    });

    it('respects custom thresholds for splitting', async () => {
      // topPreserveThreshold=0.1, preserveThreshold=0.3
      // 20 messages: topSplitIndex = ceil(20 * 0.1) = 2
      //              bottomSplitIndex = floor(20 * 0.7) = 14
      // Top: 0..1 (2 messages), Middle: 2..13 (12 messages), Bottom: 14..19 (6 messages)
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        topPreserveThreshold: 0.1,
        preserveThreshold: 0.3,
      });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.metadata.topPreserved).toBe(2);
      expect(result.metadata.bottomPreserved).toBe(6);
      expect(result.metadata.middleCompressed).toBe(12);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Tool-call boundary respect
  // -----------------------------------------------------------------------

  describe('tool-call boundary respect', () => {
    it('does not orphan tool responses at the top split boundary', async () => {
      // Build history where a naive split at the top boundary would land
      // on a tool response. The strategy should adjust the boundary.
      // 20 messages, topPreserveThreshold=0.2 → topSplitIndex = ceil(20*0.2) = 4
      // Place a tool call at index 3 and tool response at index 4.
      const history: IContent[] = [
        humanMsg('msg 0'), // 0
        aiTextMsg('msg 1'), // 1
        humanMsg('msg 2'), // 2
        aiToolCallMsg({ id: 'c1', name: 'search' }), // 3
        toolResponseMsg('c1', 'search', 'found'), // 4 ← naive top split lands here
        humanMsg('msg 5'), // 5
        aiTextMsg('msg 6'), // 6
        humanMsg('msg 7'), // 7
        aiTextMsg('msg 8'), // 8
        humanMsg('msg 9'), // 9
        aiTextMsg('msg 10'), // 10
        humanMsg('msg 11'), // 11
        aiTextMsg('msg 12'), // 12
        humanMsg('msg 13'), // 13
        aiTextMsg('msg 14'), // 14
        humanMsg('msg 15'), // 15
        aiTextMsg('msg 16'), // 16
        humanMsg('msg 17'), // 17
        aiTextMsg('msg 18'), // 18
        humanMsg('msg 19'), // 19
      ];

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      // The top preserved messages should not end mid-tool-call:
      // no tool response should appear as the first message after the summary
      const topMessages = result.newHistory.slice(
        0,
        result.metadata.topPreserved!,
      );
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - result.metadata.bottomPreserved!,
      );

      // Check: top messages shouldn't end with an orphaned tool call
      // (i.e., an AI with tool_call whose response isn't also in top)
      const lastTop = topMessages[topMessages.length - 1];
      if (lastTop?.speaker === 'ai') {
        const toolCalls = lastTop.blocks.filter((b) => b.type === 'tool_call');
        if (toolCalls.length > 0) {
          // If the last top message has tool calls, their responses
          // must also be in the top portion
          for (const call of toolCalls) {
            const hasResponse = topMessages.some(
              (msg) =>
                msg.speaker === 'tool' &&
                msg.blocks.some(
                  (b) =>
                    b.type === 'tool_response' &&
                    'callId' in b &&
                    b.callId === (call as { id: string }).id,
                ),
            );
            expect(hasResponse).toBe(true);
          }
        }
      }

      // Bottom messages should not start with an orphaned tool response
      if (bottomMessages.length > 0) {
        const firstBottom = bottomMessages[0];
        expect(firstBottom.speaker).not.toBe('tool');
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. LLM call — middle section sent to provider, summary appears in result
  // -----------------------------------------------------------------------

  describe('LLM call', () => {
    it('sends middle section to provider and includes returned summary in result', async () => {
      const customSummary =
        'Custom LLM compression summary about the conversation';
      const fakeProvider = createFakeProvider(
        'summary-provider',
        customSummary,
      );
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        resolveProvider: () => fakeProvider,
      });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      // The summary should appear in the newHistory as a human message
      // between the top and bottom sections
      const topCount = result.metadata.topPreserved!;
      const summaryMessage = result.newHistory[topCount];
      expect(summaryMessage).toBeDefined();
      expect(summaryMessage.speaker).toBe('human');
      expect(summaryMessage.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(customSummary),
      });
    });
  });

  // -----------------------------------------------------------------------
  // 4. Profile resolution — compressionProfile selects the right provider
  // -----------------------------------------------------------------------

  describe('profile resolution', () => {
    it('uses the profile-specific provider when compressionProfile is set', async () => {
      const profileSummary = 'Summary from profile provider';
      const defaultSummary = 'Summary from default provider';

      const profileProvider = createFakeProvider(
        'profile-provider',
        profileSummary,
      );
      const defaultProvider = createFakeProvider(
        'default-provider',
        defaultSummary,
      );

      const history = generateHistory(20);
      const strategy = new MiddleOutStrategy();

      const ctxWithProfile = buildContext({
        history,
        compressionProfile: 'compression-profile',
        resolveProvider: (profileName?: string) => {
          if (profileName === 'compression-profile') {
            return profileProvider;
          }
          return defaultProvider;
        },
      });
      const profileResult = await strategy.compress(ctxWithProfile);
      const topCount = profileResult.metadata.topPreserved!;
      const summaryMsg = profileResult.newHistory[topCount];
      expect(summaryMsg.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(profileSummary),
      });
    });
  });

  // -----------------------------------------------------------------------
  // 5. Default model — resolveProvider called without name
  // -----------------------------------------------------------------------

  describe('default model', () => {
    it('uses default provider when no compression profile is configured', async () => {
      const defaultSummary = 'Default provider summary output';
      const defaultProvider = createFakeProvider('my-default', defaultSummary);

      const history = generateHistory(20);
      let resolvedWithProfileName: string | undefined = 'NOT_CALLED';
      const ctx = buildContext({
        history,
        resolveProvider: (profileName?: string) => {
          resolvedWithProfileName = profileName;
          return defaultProvider;
        },
      });

      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      // Verify the summary from the default provider appears in the output
      const topCount = result.metadata.topPreserved!;
      const summaryMsg = result.newHistory[topCount];
      expect(summaryMsg.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(defaultSummary),
      });

      // The resolveProvider should have been called (we know because its
      // output appeared). And without a profile it should be called without
      // a profile name (undefined).
      expect(resolvedWithProfileName).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 6. Result assembly shape
  // -----------------------------------------------------------------------

  describe('result assembly shape', () => {
    it('produces newHistory of [...top, humanSummary, aiAck, ...bottom]', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const bottomCount = result.metadata.bottomPreserved!;

      // Verify structure: top + summary + ack + bottom
      expect(result.newHistory).toHaveLength(topCount + 2 + bottomCount);

      // Top messages should match original history
      for (let i = 0; i < topCount; i++) {
        expect(result.newHistory[i]).toBe(history[i]);
      }

      // Summary message (human)
      const summaryMsg = result.newHistory[topCount];
      expect(summaryMsg.speaker).toBe('human');
      expect(summaryMsg.blocks).toHaveLength(1);
      expect(summaryMsg.blocks[0].type).toBe('text');

      // Acknowledgment message (ai)
      const ackMsg = result.newHistory[topCount + 1];
      expect(ackMsg.speaker).toBe('ai');
      expect(ackMsg.blocks).toHaveLength(1);
      expect(ackMsg.blocks[0].type).toBe('text');

      // Bottom messages should match original history's tail
      const originalBottomStart = history.length - bottomCount;
      for (let i = 0; i < bottomCount; i++) {
        expect(result.newHistory[topCount + 2 + i]).toBe(
          history[originalBottomStart + i],
        );
      }
    });

    it('AI acknowledgment message has the expected text', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];

      expect(ackMsg.speaker).toBe('ai');
      const textBlock = ackMsg.blocks[0];
      expect(textBlock.type).toBe('text');
      expect((textBlock as { text: string }).text).toBe(
        'Understood. Continuing with the current task.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // 7. Metadata completeness
  // -----------------------------------------------------------------------

  describe('metadata completeness', () => {
    it('populates all required metadata fields', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      const meta = result.metadata;

      expect(meta.originalMessageCount).toBe(20);
      expect(meta.compressedMessageCount).toBe(result.newHistory.length);
      expect(meta.strategyUsed).toBe('middle-out');
      expect(meta.llmCallMade).toBe(true);
      expect(typeof meta.topPreserved).toBe('number');
      expect(typeof meta.bottomPreserved).toBe('number');
      expect(typeof meta.middleCompressed).toBe('number');

      // Consistency checks
      expect(
        meta.topPreserved! + meta.middleCompressed! + meta.bottomPreserved!,
      ).toBe(meta.originalMessageCount);
      expect(meta.compressedMessageCount).toBe(
        meta.topPreserved! + 2 + meta.bottomPreserved!,
      );
    });

    it('sets llmCallMade to true when compression occurs', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      expect(result.metadata.llmCallMade).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Minimum compressible — < 4 middle messages returns original
  // -----------------------------------------------------------------------

  describe('minimum compressible', () => {
    it('returns original history when fewer than 4 middle messages', async () => {
      // 6 messages, thresholds=0.2:
      // topSplitIndex = ceil(6 * 0.2) = 2
      // bottomSplitIndex = floor(6 * 0.8) = 4
      // middle = 4 - 2 = 2 < 4 → no compression
      const history = generateHistory(6);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(6);
      expect(result.metadata.compressedMessageCount).toBe(6);
      expect(result.metadata.originalMessageCount).toBe(6);
      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.metadata.strategyUsed).toBe('middle-out');
    });

    it('returns original history for very small conversation', async () => {
      const history = generateHistory(3);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(result.newHistory[i]).toBe(history[i]);
      }
      expect(result.metadata.llmCallMade).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Empty middle after boundary adjustment — returns original
  // -----------------------------------------------------------------------

  describe('empty middle after boundary adjustment', () => {
    it('returns original when tool-call boundary adjustment eliminates the middle', async () => {
      // Construct a scenario where the middle section is entirely tool call/response
      // pairs that can't be split, causing boundary adjustment to overlap.
      // Use thresholds that produce a small middle, then fill it with tool pairs.
      //
      // 10 messages, topPreserveThreshold=0.3, preserveThreshold=0.3
      // topSplitIndex = ceil(10 * 0.3) = 3
      // bottomSplitIndex = floor(10 * 0.7) = 7
      // middle = 7 - 3 = 4 messages (indices 3,4,5,6)
      //
      // If index 3 is a tool response, forward adjustment may push top past the
      // bottom split, causing overlap → original returned.
      const history: IContent[] = [
        humanMsg('start'), // 0
        aiTextMsg('thinking'), // 1
        aiToolCallMsg({ id: 'c1', name: 'big_search' }), // 2
        toolResponseMsg('c1', 'big_search', 'lots of data'), // 3 ← top split
        toolResponseMsg('c1', 'big_search', 'more data'), // 4
        toolResponseMsg('c1', 'big_search', 'even more'), // 5
        toolResponseMsg('c1', 'big_search', 'final chunk'), // 6
        humanMsg('ok what did you find'), // 7 ← bottom split
        aiTextMsg('here is what I found'), // 8
        humanMsg('thanks'), // 9
      ];

      const ctx = buildContext({
        history,
        topPreserveThreshold: 0.3,
        preserveThreshold: 0.3,
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      // Boundary adjustment should push both splits to accommodate tool
      // call boundaries, likely causing overlap → returns original
      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.newHistory).toHaveLength(history.length);
      expect(result.metadata.compressedMessageCount).toBe(
        result.metadata.originalMessageCount,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge case tests
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty history gracefully', async () => {
      const ctx = buildContext({ history: [] });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(0);
      expect(result.metadata.originalMessageCount).toBe(0);
      expect(result.metadata.compressedMessageCount).toBe(0);
      expect(result.metadata.llmCallMade).toBe(false);
    });

    it('handles history with exactly the minimum compressible middle', async () => {
      // Need exactly 4 middle messages after boundary calculation.
      // 10 messages, thresholds=0.2:
      // topSplitIndex = ceil(10 * 0.2) = 2
      // bottomSplitIndex = floor(10 * 0.8) = 8
      // middle = 8 - 2 = 6 ≥ 4 → should compress
      const history = generateHistory(10);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.middleCompressed).toBeGreaterThanOrEqual(4);
    });

    it('provider stream with multiple chunks is aggregated into full summary', async () => {
      const multiChunkProvider: IProvider = {
        name: 'multi-chunk',
        getModels: async () => [],
        getDefaultModel: () => 'fake-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'First part. ' }],
          };
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'Second part.' }],
          };
        },
      } as unknown as IProvider;

      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        resolveProvider: () => multiChunkProvider,
      });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      const topCount = result.metadata.topPreserved!;
      const summaryMsg = result.newHistory[topCount];
      const summaryText = (summaryMsg.blocks[0] as { text: string }).text;

      // Both chunks should appear in the aggregated summary
      expect(summaryText).toContain('First part.');
      expect(summaryText).toContain('Second part.');
    });
  });
});
