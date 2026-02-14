/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the OneShotStrategy compression strategy.
 *
 * This strategy summarizes the entire history except the last N messages
 * in a single LLM call. Unlike middle-out (top + bottom preserved),
 * one-shot preserves ONLY the recent tail. The summary replaces
 * everything above the preserved messages.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';
import type { CompressionContext } from './types.js';
import type { IProvider } from '../../providers/IProvider.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import type { Logger } from '../logger.js';
import type { PromptResolver } from '../../prompt-config/prompt-resolver.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { CompressionExecutionError } from './types.js';

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
  '<state_snapshot>One-shot compressed summary</state_snapshot>';

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

function createEmptyProvider(): IProvider {
  return {
    name: 'empty-provider',
    getModels: async () => [],
    getDefaultModel: () => 'fake-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: '' }],
      };
    },
  } as unknown as IProvider;
}

function createThrowingProvider(): IProvider {
  return {
    name: 'throwing-provider',
    getModels: async () => [],
    getDefaultModel: () => 'fake-model',
    getServerTools: () => [],
    invokeServerTool: async () => {
      throw new Error('provider error');
    },
    async *generateChatCompletion() {
      throw new Error('provider exploded');
      yield undefined as never;
    },
  } as unknown as IProvider;
}

// ---------------------------------------------------------------------------
// Stub logger
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
      compressionThreshold: () => 0.8,
      contextLimit: () => 100000,
      preserveThreshold: () => overrides.preserveThreshold ?? 0.2,
      topPreserveThreshold: () => 0.2,
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

describe('OneShotStrategy', () => {
  // -----------------------------------------------------------------------
  // Interface contract
  // -----------------------------------------------------------------------

  describe('interface contract', () => {
    it('has name "one-shot"', () => {
      const strategy = new OneShotStrategy();
      expect(strategy.name).toBe('one-shot');
    });

    it('requiresLLM is true', () => {
      const strategy = new OneShotStrategy();
      expect(strategy.requiresLLM).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Empty / too-small history → no compression
  // -----------------------------------------------------------------------

  describe('no compression needed', () => {
    it('returns empty history unchanged', async () => {
      const ctx = buildContext({ history: [] });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      expect(result.newHistory).toEqual([]);
      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.metadata.strategyUsed).toBe('one-shot');
    });

    it('returns history unchanged when too few messages to compress', async () => {
      const history = generateHistory(3);
      const ctx = buildContext({ history });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(3);
      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.metadata.originalMessageCount).toBe(3);
      expect(result.metadata.compressedMessageCount).toBe(3);
    });

    it('returns history unchanged when compress portion would be < 4', async () => {
      // 5 messages with 0.2 preserve = keep last 1, compress 4 → ok
      // But 5 messages with 0.5 preserve = keep last 2-3, compress 2-3 → too few
      const history = generateHistory(5);
      const ctx = buildContext({ history, preserveThreshold: 0.5 });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      // floor(5 * 0.5) = 2 messages to compress, which is < 4
      expect(result.metadata.llmCallMade).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Normal compression
  // -----------------------------------------------------------------------

  describe('normal compression', () => {
    it('compresses everything except the preserved tail', async () => {
      // 20 messages, preserveThreshold 0.2 → keep last 4, compress first 16
      const history = generateHistory(20);
      const ctx = buildContext({ history, preserveThreshold: 0.2 });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.strategyUsed).toBe('one-shot');
      expect(result.metadata.topPreserved).toBe(0);
      expect(result.metadata.bottomPreserved).toBeGreaterThan(0);
      expect(result.metadata.middleCompressed).toBeGreaterThan(0);

      // Result starts with summary + ack, then preserved tail
      expect(result.newHistory[0].speaker).toBe('human');
      expect(result.newHistory[0].blocks[0]).toEqual(
        expect.objectContaining({ type: 'text', text: KNOWN_SUMMARY }),
      );
      expect(result.newHistory[1].speaker).toBe('ai');
      expect(result.newHistory[1].blocks[0]).toEqual(
        expect.objectContaining({
          type: 'text',
          text: 'Understood. Continuing with the current task.',
        }),
      );

      // Preserved tail should be the last messages from original history
      const preservedCount = result.metadata.bottomPreserved!;
      const expectedTail = history.slice(history.length - preservedCount);
      const actualTail = result.newHistory.slice(2);
      expect(actualTail).toEqual(expectedTail);
    });

    it('does not preserve any top messages (unlike middle-out)', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history, preserveThreshold: 0.2 });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.topPreserved).toBe(0);
    });

    it('compressed count is less than original', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.compressedMessageCount).toBeLessThan(
        result.metadata.originalMessageCount,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Profile routing
  // -----------------------------------------------------------------------

  describe('compression profile', () => {
    it('passes compression profile to resolveProvider', async () => {
      const history = generateHistory(20);
      let capturedProfile: string | undefined;
      const profileProvider = createFakeProvider('profile-provider');

      const ctx = buildContext({
        history,
        compressionProfile: 'my-flash-profile',
        resolveProvider: (p) => {
          capturedProfile = p;
          return profileProvider;
        },
      });

      const strategy = new OneShotStrategy();
      await strategy.compress(ctx);

      expect(capturedProfile).toBe('my-flash-profile');
    });

    it('passes undefined when no compression profile is set', async () => {
      const history = generateHistory(20);
      let capturedProfile: string | undefined = 'SENTINEL';
      const defaultProvider = createFakeProvider('default-provider');

      const ctx = buildContext({
        history,
        resolveProvider: (p) => {
          capturedProfile = p;
          return defaultProvider;
        },
      });

      const strategy = new OneShotStrategy();
      await strategy.compress(ctx);

      expect(capturedProfile).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Tool call boundary respect
  // -----------------------------------------------------------------------

  describe('tool call boundary', () => {
    it('adjusts split to avoid orphaning tool responses', async () => {
      // Build history where the split point lands inside a tool call sequence
      const history: IContent[] = [
        humanMsg('msg 0'),
        aiTextMsg('msg 1'),
        humanMsg('msg 2'),
        aiTextMsg('msg 3'),
        humanMsg('msg 4'),
        aiTextMsg('msg 5'),
        humanMsg('msg 6'),
        aiTextMsg('msg 7'),
        // Tool call pair that straddles the boundary:
        aiToolCallMsg({ id: 'call-1', name: 'read_file' }),
        toolResponseMsg('call-1', 'read_file', 'file content'),
        // Preserved tail:
        humanMsg('msg 10'),
        aiTextMsg('msg 11'),
      ];

      // preserveThreshold = 0.2 → splitIndex = floor(12 * 0.8) = 9
      // That lands on the tool response — boundary adjustment should move it
      const ctx = buildContext({ history, preserveThreshold: 0.2 });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      // Should still compress and produce valid result
      expect(result.metadata.llmCallMade).toBe(true);

      // The preserved tail should not contain orphaned tool responses
      const tail = result.newHistory.slice(2); // after summary + ack
      for (const msg of tail) {
        if (msg.speaker === 'tool') {
          // If there's a tool response in the tail, its corresponding
          // tool call should also be in the tail
          const toolCallId = msg.blocks.find((b) => b.type === 'tool_response');
          if (toolCallId && 'callId' in toolCallId) {
            const hasCall = tail.some(
              (m) =>
                m.speaker === 'ai' &&
                m.blocks.some(
                  (b) =>
                    b.type === 'tool_call' &&
                    'id' in b &&
                    b.id === toolCallId.callId,
                ),
            );
            expect(hasCall).toBe(true);
          }
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('throws CompressionExecutionError when LLM returns empty', async () => {
      const history = generateHistory(20);
      const emptyProvider = createEmptyProvider();

      const ctx = buildContext({
        history,
        resolveProvider: () => emptyProvider,
      });

      const strategy = new OneShotStrategy();
      await expect(strategy.compress(ctx)).rejects.toThrow(
        CompressionExecutionError,
      );
    });

    it('throws CompressionExecutionError when provider fails', async () => {
      const history = generateHistory(20);
      const throwingProvider = createThrowingProvider();

      const ctx = buildContext({
        history,
        resolveProvider: () => throwingProvider,
      });

      const strategy = new OneShotStrategy();
      await expect(strategy.compress(ctx)).rejects.toThrow(
        CompressionExecutionError,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  describe('metadata', () => {
    it('reports correct metadata fields', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new OneShotStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.strategyUsed).toBe('one-shot');
      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.topPreserved).toBe(0);
      expect(result.metadata.originalMessageCount).toBe(20);
      expect(result.metadata.bottomPreserved).toBeGreaterThan(0);
      expect(result.metadata.middleCompressed).toBeGreaterThan(0);
      expect(
        result.metadata.bottomPreserved! + result.metadata.middleCompressed!,
      ).toBe(20);
    });
  });
});
