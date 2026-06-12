/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines -- comprehensive behavioral test coverage for media sanitization (#1889) */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 * @requirement REQ-CS-002.1, REQ-CS-002.2, REQ-CS-002.3, REQ-CS-002.4
 * @requirement REQ-CS-002.5, REQ-CS-002.6, REQ-CS-002.7, REQ-CS-002.8
 *
 * Behavioral tests for the MiddleOutStrategy compression strategy.
 * Extracted from the sandwich compression logic in chatSession.ts.
 *
 * These tests verify the strategy's output structure and metadata — not
 * internal spy calls.  The "fake provider" returns a known summary so we
 * can assert on the assembled result, which is real behavioral verification.
 */

import { describe, it, expect } from 'vitest';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  EmptySummaryError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { Logger } from '@vybestack/llxprt-code-core/core/logger.js';
import type { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';
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

function _mediaBlock(
  mimeType: string,
  filename?: string,
  data = 'base64data',
  caption?: string,
): MediaBlock {
  return {
    type: 'media',
    mimeType,
    filename,
    data,
    encoding: 'base64',
    caption,
  };
}

function humanMsgWithMedia(
  text: string,
  ...mediaBlocks: MediaBlock[]
): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }, ...mediaBlocks],
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

class CaptureProvider implements IProvider {
  readonly name = 'capture-provider';

  constructor(
    private readonly capturedRequests: IContent[],
    private readonly summaryText: string = KNOWN_SUMMARY,
  ) {}

  getModels(): Promise<[]> {
    return Promise.resolve([]);
  }

  getDefaultModel(): string {
    return 'capture-model';
  }

  getServerTools(): string[] {
    return [];
  }

  invokeServerTool(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(content: IContent[]): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: RuntimeGenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const contents = Array.isArray(optionsOrContent)
      ? optionsOrContent
      : optionsOrContent.contents;
    this.capturedRequests.push(...contents);
    yield {
      speaker: 'ai' as const,
      blocks: [{ type: 'text' as const, text: this.summaryText }],
    };
  }
}

function createCaptureProvider(
  capturedRequests: IContent[],
  summaryText: string = KNOWN_SUMMARY,
): IProvider {
  return new CaptureProvider(capturedRequests, summaryText);
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

const testProviderRuntime = {
  settingsService: {
    get: () => undefined,
    set: () => {},
    getProviderSettings: () => ({}),
  },
  config: undefined,
  runtimeId: 'test-provider-runtime',
  metadata: { source: 'test' },
};

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
    resolveProvider: (profileName?: string) => CompressionProviderResult;
    model: string;
    provider: string;
    currentTokenCount: number;
  }> = {},
): CompressionContext {
  const defaultProvider = createFakeProvider('default-provider');
  const defaultRuntime = {
    settingsService: {
      get: () => undefined,
      set: () => {},
      getProviderSettings: () => ({}),
    },
    config: undefined,
    runtimeId: 'test-provider-runtime',
    metadata: { source: 'test' },
  };
  const resolveProvider =
    overrides.resolveProvider ??
    (() => ({ provider: defaultProvider, runtime: defaultRuntime }));

  const runtimeState: AgentRuntimeState = {
    runtimeId: 'test-runtime',
    provider: overrides.provider ?? 'test-provider',
    model: overrides.model ?? 'test-model',
    sessionId: 'test-session',
    updatedAt: Date.now(),
  };

  const contextProviderRuntime = {
    settingsService: {
      get: () => undefined,
      set: () => {},
      getProviderSettings: () => ({}),
    },
    config: undefined,
    runtimeId: 'test-provider-runtime',
    metadata: { source: 'test' },
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
    providerRuntime: contextProviderRuntime,
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
        result.metadata.topPreserved ?? 0,
      );
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - (result.metadata.bottomPreserved ?? 0),
      );

      // Check: top messages shouldn't end with an orphaned tool call
      // (i.e., an AI with tool_call whose response isn't also in top)
      const lastTop = topMessages[topMessages.length - 1];
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (lastTop.speaker === 'ai') {
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
            // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
            expect(hasResponse).toBe(true);
          }
        }
      }

      // Bottom messages should not start with an orphaned tool response
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (bottomMessages.length > 0) {
        const firstBottom = bottomMessages[0];
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
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
        resolveProvider: () => ({
          provider: fakeProvider,
          runtime: testProviderRuntime,
        }),
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
            return { provider: profileProvider, runtime: testProviderRuntime };
          }
          return { provider: defaultProvider, runtime: testProviderRuntime };
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
          return { provider: defaultProvider, runtime: testProviderRuntime };
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
      const ackText = (textBlock as { type: 'text'; text: string }).text;
      expect(ackText).toContain('Understood.');
      expect(ackText).toContain('Continuing with the current task.');
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
        resolveProvider: () => ({
          provider: multiChunkProvider,
          runtime: testProviderRuntime,
        }),
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

  // -----------------------------------------------------------------------
  // Last user prompt preservation
  // -----------------------------------------------------------------------

  describe('last user prompt preservation', () => {
    it('preserves short last user prompt literally when it falls in toCompress', async () => {
      // Build 20 messages where the last human message is at index 10
      // (inside toCompress range 4..15 with default thresholds).
      // All messages after index 10 are AI-only so the last human is at 10.
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 10) {
          history.push(humanMsg('fix the failing auth test'));
        } else if (i <= 10 && i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const bottomStart =
        result.newHistory.length - result.metadata.bottomPreserved!;
      const bottomMessages = result.newHistory.slice(bottomStart);
      const bottomTexts = bottomMessages
        .filter((m) => m.speaker === 'human')
        .flatMap((m) =>
          m.blocks
            .filter(
              (b): b is { type: 'text'; text: string } => b.type === 'text',
            )
            .map((b) => b.text),
        );
      expect(bottomTexts).toContain('fix the failing auth test');
    });

    it('does not modify split when last human message is already in toKeepBottom', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      const lastHumanIndex = [...history]
        .reverse()
        .findIndex((m) => m.speaker === 'human');
      const lastHumanOriginalIndex = history.length - 1 - lastHumanIndex;

      const bottomSplitIndex = Math.floor(history.length * (1 - 0.2));
      expect(lastHumanOriginalIndex).toBeGreaterThanOrEqual(bottomSplitIndex);
      expect(result.metadata.llmCallMade).toBe(true);
    });

    it('handles history with no human messages', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        history.push(aiTextMsg(`ai message ${i}`));
      }

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.strategyUsed).toBe('middle-out');
    });

    it('continuation directive includes last user prompt context when prompt is preserved', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 8) {
          history.push(humanMsg('please fix the database connection issue'));
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      expect(ackMsg.speaker).toBe('ai');
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).toContain('most recent request');
    });

    it('handles large last user prompt via context injection', async () => {
      const longText = 'x'.repeat(5000);
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 8) {
          history.push(humanMsg(longText));
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.strategyUsed).toBe('middle-out');

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).toContain('most recent request');
    });
  });

  // -----------------------------------------------------------------------
  // Media block sanitization — issue #1889
  // -----------------------------------------------------------------------

  describe('media block sanitization (issue #1889)', () => {
    it('does not send raw media bytes to the compression provider for middle messages with images', async () => {
      // Build 20 messages where some middle messages contain MediaBlocks
      // with raw base64 data. The compression provider should never
      // receive a MediaBlock in its request — all should be text placeholders.
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 5) {
          // This message is in the compressed middle section and has a media block
          history.push(
            humanMsgWithMedia('Here is the screenshot:', {
              type: 'media',
              mimeType: 'image/png',
              data: 'not-valid-base64===',
              encoding: 'base64',
              filename: 'screenshot.png',
            }),
          );
        } else if (i === 8) {
          // Another middle message with a media block
          history.push(
            humanMsgWithMedia('And this PDF document:', {
              type: 'media',
              mimeType: 'application/pdf',
              data: 'JVBERi0xLjQ=',
              encoding: 'base64',
              filename: 'report.pdf',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed summary</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      // Verify compression succeeded
      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.strategyUsed).toBe('middle-out');

      // Verify the provider received no MediaBlock in its request
      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaBlocks = allBlocks.filter((b) => b.type === 'media');
      expect(mediaBlocks).toHaveLength(0);

      // Verify no raw base64 data leaked into text blocks either
      const textBlocks = allBlocks.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text',
      );
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('not-valid-base64===');
        expect(tb.text).not.toContain('JVBERi0xLjQ=');
      }

      // Verify media placeholders are present in the provider request
      const placeholderTexts = textBlocks.map((b) => b.text);
      const hasScreenshotPlaceholder = placeholderTexts.some(
        (t) =>
          t.includes('[Attached image: screenshot.png]') ||
          t.includes('screenshot.png'),
      );
      const hasPdfPlaceholder = placeholderTexts.some(
        (t) =>
          t.includes('[Attached PDF: report.pdf]') || t.includes('report.pdf'),
      );
      expect(hasScreenshotPlaceholder).toBe(true);
      expect(hasPdfPlaceholder).toBe(true);

      const bottomCount = result.metadata.bottomPreserved!;
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - bottomCount,
      );
      expect(bottomMessages).toStrictEqual(
        history.slice(history.length - bottomCount),
      );
    });

    it('preserves media blocks in top and bottom sections that are not sent to the LLM', async () => {
      // Build history where top and bottom sections contain media blocks
      // These should appear unchanged in the final result
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 0) {
          // Top section message with media
          history.push(
            humanMsgWithMedia('Initial screenshot', {
              type: 'media',
              mimeType: 'image/png',
              data: 'toppngdata',
              encoding: 'base64',
              filename: 'initial.png',
            }),
          );
        } else if (i === 19) {
          // Bottom section message with media
          history.push(
            humanMsgWithMedia('Final screenshot', {
              type: 'media',
              mimeType: 'image/jpeg',
              data: 'bottomjpgdata',
              encoding: 'base64',
              filename: 'final.jpg',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      // Top message with media should be preserved in final result
      const topCount = result.metadata.topPreserved!;
      const topMessages = result.newHistory.slice(0, topCount);
      const topMediaBlocks = topMessages.flatMap((m) =>
        m.blocks.filter((b) => b.type === 'media'),
      );
      expect(topMediaBlocks).toHaveLength(1);
      expect(topMediaBlocks[0].filename).toBe('initial.png');

      // Bottom message with media should be preserved in final result
      const bottomCount = result.metadata.bottomPreserved!;
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - bottomCount,
      );
      const bottomMediaBlocks = bottomMessages.flatMap((m) =>
        m.blocks.filter((b) => b.type === 'media'),
      );
      expect(bottomMediaBlocks).toHaveLength(1);
      expect(bottomMediaBlocks[0].filename).toBe('final.jpg');

      // But the provider request should contain NO media blocks
      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaInRequest = allBlocks.filter((b) => b.type === 'media');
      expect(mediaInRequest).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Regression: media in largeLastPromptInjection — issue #1889
  // -----------------------------------------------------------------------

  describe('largeLastPromptInjection media sanitization (issue #1889)', () => {
    it('uses text placeholders for media blocks in the largeLastPromptInjection (no raw media in provider request)', async () => {
      const longText = 'x'.repeat(5000);
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 9) {
          history.push(
            humanMsgWithMedia(longText, {
              type: 'media',
              mimeType: 'image/png',
              data: 'malformed-base64===',
              encoding: 'base64',
              filename: 'crash-screenshot.png',
              caption: 'Error screenshot showing crash',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed summary</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaBlocks = allBlocks.filter((b) => b.type === 'media');
      expect(mediaBlocks).toHaveLength(0);

      const textBlocks = allBlocks.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text',
      );
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('malformed-base64===');
      }

      const injectionTexts = textBlocks.map((b) => b.text);
      const hasCrashPlaceholder = injectionTexts.some(
        (t) =>
          t.includes('[Attached image: Error screenshot showing crash]') ||
          t.includes('[Attached image: crash-screenshot.png]'),
      );
      expect(hasCrashPlaceholder).toBe(true);

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      expect(ackMsg.speaker).toBe('ai');
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).not.toContain('malformed-base64===');
    });

    it('uses placeholders when the large last human prompt in compress range includes media', async () => {
      const longText = 'y'.repeat(5000);
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 9) {
          history.push({
            speaker: 'human',
            blocks: [
              { type: 'text', text: longText },
              {
                type: 'media',
                mimeType: 'image/webp',
                data: 'AAAA=',
                encoding: 'base64',
                filename: 'diagram.webp',
              },
            ],
          });
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaBlocks = allBlocks.filter((b) => b.type === 'media');
      expect(mediaBlocks).toHaveLength(0);

      const textBlocks = allBlocks.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text',
      );
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('AAAA=');
      }

      const injectionTexts = textBlocks.map((b) => b.text);
      const hasDiagramPlaceholder = injectionTexts.some((t) =>
        t.includes('[Attached image: diagram.webp]'),
      );
      expect(hasDiagramPlaceholder).toBe(true);
    });

    it('no media blocks reach the provider when short prompt with media is moved to bottom', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 9) {
          history.push(
            humanMsgWithMedia('Check this image:', {
              type: 'media',
              mimeType: 'image/jpeg',
              data: 'base64imagedata==',
              encoding: 'base64',
              filename: 'photo.jpg',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const capturedRequests: IContent[] = [];
      const captureProvider = createCaptureProvider(
        capturedRequests,
        '<state_snapshot>Compressed</state_snapshot>',
      );

      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: captureProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);

      const allBlocks = capturedRequests.flatMap((m) => m.blocks);
      const mediaInRequest = allBlocks.filter((b) => b.type === 'media');
      expect(mediaInRequest).toHaveLength(0);

      const textBlocks = allBlocks.filter(
        (b): b is { type: 'text'; text: string } => b.type === 'text',
      );
      for (const tb of textBlocks) {
        expect(tb.text).not.toContain('base64imagedata==');
      }

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).not.toContain('base64imagedata==');
    });

    it('lastUserPromptContext string contains placeholder text, not raw media data, for messages with media', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 19) {
          history.push(
            humanMsgWithMedia('Look at this chart:', {
              type: 'media',
              mimeType: 'image/png',
              data: 'rawchartdata=',
              encoding: 'base64',
              filename: 'chart.png',
              caption: 'Revenue chart Q4',
            }),
          );
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const defaultProvider = createFakeProvider('default-provider');
      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: defaultProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;

      expect(ackText).not.toContain('rawchartdata=');
      expect(ackText).toContain('[Attached image: Revenue chart Q4]');
    });
  });

  // -----------------------------------------------------------------------
  // Empty summary handling — transient error for retry
  // -----------------------------------------------------------------------

  describe('empty summary handling', () => {
    it('throws EmptySummaryError when LLM returns empty summary', async () => {
      const emptyProvider = createFakeProvider('empty-provider', '');
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: emptyProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();

      await expect(strategy.compress(ctx)).rejects.toThrow(EmptySummaryError);
      try {
        await strategy.compress(ctx);
      } catch (error) {
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(error).toBeInstanceOf(EmptySummaryError);
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(isTransientCompressionError(error)).toBe(false);
      }
    });

    it('throws EmptySummaryError when LLM returns whitespace-only summary', async () => {
      const whitespaceProvider = createFakeProvider(
        'whitespace-provider',
        '   \n  \t  ',
      );
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: whitespaceProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();

      await expect(strategy.compress(ctx)).rejects.toThrow(EmptySummaryError);
      try {
        await strategy.compress(ctx);
      } catch (error) {
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(error).toBeInstanceOf(EmptySummaryError);
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(isTransientCompressionError(error)).toBe(false);
      }
    });
  });
});
