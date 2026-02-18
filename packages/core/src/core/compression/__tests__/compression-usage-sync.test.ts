/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for compression usage-data sync (Issue #1211).
 *
 * Verifies that:
 * 1. CompressionResultMetadata includes usage data when compression occurs via
 *    an LLM call.
 * 2. The summary IContent has usage metadata attached.
 * 3. MiddleOutStrategy and OneShotStrategy propagate provider usage to result.
 *
 * Tests operate on REAL strategy instances with a mock IProvider that returns
 * controlled usage values. No mock theater — only the provider boundary is
 * stubbed because it crosses a network/LLM boundary.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '../../../services/history/IContent.js';
import type { UsageStats } from '../../../services/history/IContent.js';
import type { IProvider } from '../../../providers/IProvider.js';
import type { CompressionContext } from '../types.js';
import type { AgentRuntimeContext } from '../../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../../runtime/AgentRuntimeState.js';
import type { PromptResolver } from '../../../prompt-config/PromptResolver.js';
import type { Logger } from '../../../utils/logger.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import { OneShotStrategy } from '../OneShotStrategy.js';

// ---------------------------------------------------------------------------
// Helpers: build IContent objects
// ---------------------------------------------------------------------------

function makeHumanMessage(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
}

function makeAiMessage(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  };
}

/**
 * Builds a history large enough for middle-out compression to fire
 * (needs toCompress.length >= 4).
 * With topPreserveThreshold=0.1 and preserveThreshold=0.3 on 20 messages:
 *   top  = ceil(20 * 0.1) = 2
 *   bottom = floor(20 * 0.7) = 14
 *   middle = 14 - 2 = 12  ≥ 4 → compression triggers
 */
function buildLargeHistory(count = 20): IContent[] {
  const history: IContent[] = [];
  for (let i = 0; i < count; i++) {
    history.push(
      i % 2 === 0
        ? makeHumanMessage(`Question ${i}`)
        : makeAiMessage(`Answer ${i}`),
    );
  }
  return history;
}

// ---------------------------------------------------------------------------
// Mock IProvider that emits a fixed summary with controlled usage
// ---------------------------------------------------------------------------

const SUMMARY_TEXT = '<state_snapshot>test summary</state_snapshot>';

const MOCK_USAGE: UsageStats = {
  promptTokens: 1500,
  completionTokens: 200,
  totalTokens: 1700,
};

function makeMockProvider(
  summaryText: string = SUMMARY_TEXT,
  usage: UsageStats | null = MOCK_USAGE,
): IProvider {
  return {
    generateChatCompletion: () => {
      async function* gen(): AsyncGenerator<IContent> {
        // Emit summary text chunk
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: summaryText }],
        };
        // Emit a final chunk with usage metadata (as providers do)
        if (usage !== null) {
          yield {
            speaker: 'ai',
            blocks: [],
            metadata: { usage },
          };
        }
      }
      return gen();
    },
  } as unknown as IProvider;
}

function makeMockProviderNoUsage(
  summaryText: string = SUMMARY_TEXT,
): IProvider {
  return makeMockProvider(summaryText, null);
}

// ---------------------------------------------------------------------------
// CompressionContext builder
// ---------------------------------------------------------------------------

function buildContext(
  overrides: Partial<{
    history: IContent[];
    provider: IProvider;
    preserveThreshold: number;
    topPreserveThreshold: number;
  }> = {},
): CompressionContext {
  const history = overrides.history ?? buildLargeHistory();
  const provider = overrides.provider ?? makeMockProvider();
  const preserveThreshold = overrides.preserveThreshold ?? 0.3;
  const topPreserveThreshold = overrides.topPreserveThreshold ?? 0.1;

  return {
    history,
    runtimeContext: {
      ephemerals: {
        preserveThreshold: () => preserveThreshold,
        topPreserveThreshold: () => topPreserveThreshold,
        compressionThreshold: () => 0.85,
        contextLimit: () => 128000,
        compressionProfile: () => undefined,
        compressionStrategy: () => 'middle-out',
        toolFormatOverride: () => undefined,
        densityCompressHeadroom: () => 0.6,
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
    } as unknown as AgentRuntimeContext,
    runtimeState: {
      runtimeId: 'test',
      provider: 'test',
      model: 'test-model',
      sessionId: 'test',
      updatedAt: Date.now(),
    } as unknown as AgentRuntimeState,
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: history.length * 100,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    } as unknown as Logger,
    resolveProvider: () => provider,
    promptResolver: {
      resolveFile: () => ({ found: false, path: null, source: null }),
    } as unknown as PromptResolver,
    promptBaseDir: '/tmp/test',
    promptContext: { provider: 'test', model: 'test-model' },
    promptId: 'test-prompt',
  };
}

// ---------------------------------------------------------------------------
// Tests: MiddleOutStrategy usage propagation
// ---------------------------------------------------------------------------

describe('MiddleOutStrategy — usage propagation (Issue #1211)', () => {
  it('result.metadata.usage is populated when provider emits usage', async () => {
    const strategy = new MiddleOutStrategy();
    const ctx = buildContext();

    const result = await strategy.compress(ctx);

    // llmCallMade must be true — ensures we went through the provider
    expect(result.metadata.llmCallMade).toBe(true);

    // usage must be captured from provider
    expect(result.metadata.usage).toBeDefined();
    expect(result.metadata.usage?.totalTokens).toBe(MOCK_USAGE.totalTokens);
    expect(result.metadata.usage?.promptTokens).toBe(MOCK_USAGE.promptTokens);
    expect(result.metadata.usage?.completionTokens).toBe(
      MOCK_USAGE.completionTokens,
    );
  });

  it('result.metadata.usage is undefined when provider emits no usage', async () => {
    const strategy = new MiddleOutStrategy();
    const provider = makeMockProviderNoUsage();
    const ctx = buildContext({ provider });

    const result = await strategy.compress(ctx);

    expect(result.metadata.llmCallMade).toBe(true);
    expect(result.metadata.usage).toBeUndefined();
  });

  it('summary IContent has usage metadata attached when provider emits usage', async () => {
    const strategy = new MiddleOutStrategy();
    const ctx = buildContext();

    const result = await strategy.compress(ctx);

    // Find the summary IContent — it's the first human entry after toKeepTop
    // In middle-out: [toKeepTop..., summary, continuationDirective, toKeepBottom...]
    const topPreserved = result.metadata.topPreserved ?? 0;
    const summaryEntry = result.newHistory[topPreserved];

    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(summaryEntry.metadata?.usage).toBeDefined();
    expect(summaryEntry.metadata?.usage?.totalTokens).toBe(
      MOCK_USAGE.totalTokens,
    );
  });

  it('summary IContent has no usage metadata when provider emits no usage', async () => {
    const strategy = new MiddleOutStrategy();
    const provider = makeMockProviderNoUsage();
    const ctx = buildContext({ provider });

    const result = await strategy.compress(ctx);

    const topPreserved = result.metadata.topPreserved ?? 0;
    const summaryEntry = result.newHistory[topPreserved];

    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    // metadata.usage should be absent when provider gives no usage
    expect(summaryEntry.metadata?.usage).toBeUndefined();
  });

  it('no compression returns result without usage (llmCallMade=false)', async () => {
    const strategy = new MiddleOutStrategy();
    // History too small to trigger compression (< 4 middle messages)
    const tinyHistory = [makeHumanMessage('hi'), makeAiMessage('hello')];
    const ctx = buildContext({ history: tinyHistory });

    const result = await strategy.compress(ctx);

    expect(result.metadata.llmCallMade).toBe(false);
    expect(result.metadata.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: OneShotStrategy usage propagation
// ---------------------------------------------------------------------------

describe('OneShotStrategy — usage propagation (Issue #1211)', () => {
  it('result.metadata.usage is populated when provider emits usage', async () => {
    const strategy = new OneShotStrategy();
    const ctx = buildContext();

    const result = await strategy.compress(ctx);

    expect(result.metadata.llmCallMade).toBe(true);

    expect(result.metadata.usage).toBeDefined();
    expect(result.metadata.usage?.totalTokens).toBe(MOCK_USAGE.totalTokens);
    expect(result.metadata.usage?.promptTokens).toBe(MOCK_USAGE.promptTokens);
    expect(result.metadata.usage?.completionTokens).toBe(
      MOCK_USAGE.completionTokens,
    );
  });

  it('result.metadata.usage is undefined when provider emits no usage', async () => {
    const strategy = new OneShotStrategy();
    const provider = makeMockProviderNoUsage();
    const ctx = buildContext({ provider });

    const result = await strategy.compress(ctx);

    expect(result.metadata.llmCallMade).toBe(true);
    expect(result.metadata.usage).toBeUndefined();
  });

  it('summary IContent (first entry in newHistory) has usage metadata attached', async () => {
    const strategy = new OneShotStrategy();
    const ctx = buildContext();

    const result = await strategy.compress(ctx);

    // In one-shot: [summary, continuationDirective, ...toKeep]
    const summaryEntry = result.newHistory[0];

    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(summaryEntry.metadata?.usage).toBeDefined();
    expect(summaryEntry.metadata?.usage?.totalTokens).toBe(
      MOCK_USAGE.totalTokens,
    );
  });

  it('summary IContent has no usage metadata when provider emits no usage', async () => {
    const strategy = new OneShotStrategy();
    const provider = makeMockProviderNoUsage();
    const ctx = buildContext({ provider });

    const result = await strategy.compress(ctx);

    const summaryEntry = result.newHistory[0];
    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(summaryEntry.metadata?.usage).toBeUndefined();
  });

  it('no compression returns result without usage (llmCallMade=false)', async () => {
    const strategy = new OneShotStrategy();
    // History too small to trigger compression
    const tinyHistory = [makeHumanMessage('hi'), makeAiMessage('hello')];
    const ctx = buildContext({ history: tinyHistory });

    const result = await strategy.compress(ctx);

    expect(result.metadata.llmCallMade).toBe(false);
    expect(result.metadata.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: CompressionResultMetadata shape
// ---------------------------------------------------------------------------

describe('CompressionResultMetadata — usage field type (Issue #1211)', () => {
  it('usage field matches UsageStats interface shape when present', async () => {
    const strategy = new MiddleOutStrategy();
    const ctx = buildContext();

    const result = await strategy.compress(ctx);

    const usage = result.metadata.usage;
    expect(usage).toBeDefined();
    if (usage) {
      // Verify all required UsageStats fields are numbers
      expect(typeof usage.promptTokens).toBe('number');
      expect(typeof usage.completionTokens).toBe('number');
      expect(typeof usage.totalTokens).toBe('number');
      // Optional fields — just check they're number or undefined if present
      if (usage.cachedTokens !== undefined) {
        expect(typeof usage.cachedTokens).toBe('number');
      }
    }
  });

  it('usage field captures the LAST usage from provider stream (not accumulated)', async () => {
    // Provider emits two usage chunks — only the final one should be captured
    const firstUsage: UsageStats = {
      promptTokens: 500,
      completionTokens: 50,
      totalTokens: 550,
    };
    const finalUsage: UsageStats = {
      promptTokens: 1500,
      completionTokens: 200,
      totalTokens: 1700,
    };

    const provider: IProvider = {
      generateChatCompletion: () => {
        async function* gen(): AsyncGenerator<IContent> {
          // First chunk: text with early usage
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: '<state_snapshot>summary' }],
            metadata: { usage: firstUsage },
          };
          // Final chunk: rest of text + final usage
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: '</state_snapshot>' }],
            metadata: { usage: finalUsage },
          };
        }
        return gen();
      },
    } as unknown as IProvider;

    const strategy = new MiddleOutStrategy();
    const ctx = buildContext({ provider });

    const result = await strategy.compress(ctx);

    // Should capture the LAST (finalUsage), not the first
    expect(result.metadata.usage?.totalTokens).toBe(finalUsage.totalTokens);
    expect(result.metadata.usage?.promptTokens).toBe(finalUsage.promptTokens);
  });
});
