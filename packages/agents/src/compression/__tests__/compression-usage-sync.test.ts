import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
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

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/PromptResolver.js';
import type { Logger } from '@vybestack/llxprt-code-core/utils/logger.js';
import {
  compressMiddleOutViaDisk,
  requireMiddleOutApplied,
} from './support/middleout-disk-adapter.js';
import {
  compressOneShotViaDisk,
  requireApplied,
} from './support/oneshot-disk-adapter.js';

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
    name: 'usage-test-provider',
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
      providerRuntime: {
        settingsService: new SettingsService(),
        config: undefined,
        runtimeId: 'test-provider-runtime',
        metadata: { source: 'test' },
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
    resolveProvider: () => {
      const runtime = {
        settingsService: new SettingsService(),
        config: undefined,
        runtimeId: 'test-provider-runtime',
        metadata: { source: 'test' },
      };
      return {
        invocation: captureProviderInvocation(runtime, provider.name),
        provider,
        runtime,
      };
    },
    promptResolver: {
      resolveFile: () => ({ found: false, path: null, source: null }),
    } as unknown as PromptResolver,
    promptBaseDir: '/tmp/test',
    promptContext: { provider: 'test', model: 'test-model' },
    promptId: 'test-prompt',
  };
}

/**
 * Counts provider resolutions. The disk outcome carries no llmCallMade flag,
 * so the call count is the observable fact behind "an LLM call was made".
 */
function withProviderCallCount(ctx: CompressionContext): {
  ctx: CompressionContext;
  providerCalls: () => number;
} {
  let providerCalls = 0;
  return {
    ctx: {
      ...ctx,
      resolveProvider: (profileName) => {
        providerCalls++;
        return ctx.resolveProvider(profileName);
      },
    },
    providerCalls: () => providerCalls,
  };
}

// ---------------------------------------------------------------------------
// Tests: MiddleOutStrategy usage propagation
// ---------------------------------------------------------------------------

describe('MiddleOutStrategy — usage propagation (Issue #1211)', () => {
  it('summary IContent has usage metadata attached when provider emits usage', async () => {
    const {
      summaryEntry,
      usageObservation,
      totalTokensObservation,
      providerCalls,
    } =
      await observeSummaryIContentHasUsageMetadataAttachedWhenProviderEmitsUsage();
    // The provider must have been consulted for the usage to come from it.
    expect(providerCalls).toBe(1);
    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(usageObservation).toBeDefined();
    expect(totalTokensObservation).toBe(MOCK_USAGE.totalTokens);
  });

  const observeSummaryIContentHasUsageMetadataAttachedWhenProviderEmitsUsage =
    async () => {
      const { ctx, providerCalls } = withProviderCallCount(buildContext());

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      // Find the summary IContent — it's the first human entry after toKeepTop
      // In middle-out: [toKeepTop..., summary, continuationDirective, toKeepBottom...]
      const summaryEntry = result.newHistory[result.top];
      expect(summaryEntry.metadata?.usage?.promptTokens).toBe(
        MOCK_USAGE.promptTokens,
      );
      expect(summaryEntry.metadata?.usage?.completionTokens).toBe(
        MOCK_USAGE.completionTokens,
      );

      const usageObservation = summaryEntry.metadata?.usage;
      const totalTokensObservation = summaryEntry.metadata?.usage?.totalTokens;
      return {
        summaryEntry,
        usageObservation,
        totalTokensObservation,
        providerCalls: providerCalls(),
      };
    };

  it('summary IContent has no usage metadata when provider emits no usage', async () => {
    const { summaryEntry, usageObservation, providerCalls } =
      await observeSummaryIContentHasNoUsageMetadataWhenProviderEmitsNoUsage();
    expect(providerCalls).toBe(1);
    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(usageObservation).toBeUndefined();
  });

  const observeSummaryIContentHasNoUsageMetadataWhenProviderEmitsNoUsage =
    async () => {
      const provider = makeMockProviderNoUsage();
      const { ctx, providerCalls } = withProviderCallCount(
        buildContext({ provider }),
      );

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const summaryEntry = result.newHistory[result.top];

      // metadata.usage should be absent when provider gives no usage

      const usageObservation = summaryEntry.metadata?.usage;
      return {
        summaryEntry,
        usageObservation,
        providerCalls: providerCalls(),
      };
    };

  it('no compression makes no LLM call and produces no summary rows', async () => {
    // History too small to trigger compression (< 4 middle messages)
    const tinyHistory = [makeHumanMessage('hi'), makeAiMessage('hello')];
    const { ctx, providerCalls } = withProviderCallCount(
      buildContext({ history: tinyHistory }),
    );

    const result = await compressMiddleOutViaDisk(ctx);

    expect(result).toStrictEqual({ kind: 'noop', candidateRows: 0 });
    expect(providerCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: OneShotStrategy usage propagation
// ---------------------------------------------------------------------------

describe('OneShotStrategy — usage propagation (Issue #1211)', () => {
  it('summary IContent (first entry in newHistory) has usage metadata attached', async () => {
    const ctx = buildContext();

    const newHistory = requireApplied(await compressOneShotViaDisk(ctx));

    // In one-shot: [summary, continuationDirective, ...toKeep]
    const summaryEntry = newHistory[0];

    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(summaryEntry.metadata?.usage).toBeDefined();
    expect(summaryEntry.metadata?.usage?.totalTokens).toBe(
      MOCK_USAGE.totalTokens,
    );
    expect(summaryEntry.metadata?.usage?.promptTokens).toBe(
      MOCK_USAGE.promptTokens,
    );
    expect(summaryEntry.metadata?.usage?.completionTokens).toBe(
      MOCK_USAGE.completionTokens,
    );
  });

  it('summary IContent has no usage metadata when provider emits no usage', async () => {
    const provider = makeMockProviderNoUsage();
    const ctx = buildContext({ provider });

    const newHistory = requireApplied(await compressOneShotViaDisk(ctx));

    const summaryEntry = newHistory[0];
    expect(summaryEntry).toBeDefined();
    expect(summaryEntry.speaker).toBe('human');
    expect(summaryEntry.metadata?.usage).toBeUndefined();
  });

  it('no compression returns no summary rows', async () => {
    // History too small to trigger compression
    const tinyHistory = [makeHumanMessage('hi'), makeAiMessage('hello')];
    const ctx = buildContext({ history: tinyHistory });

    const result = await compressOneShotViaDisk(ctx);

    expect(result.kind).toBe('noop');
  });
});

// ---------------------------------------------------------------------------
// Tests: CompressionResultMetadata shape
// ---------------------------------------------------------------------------

describe('CompressionResultMetadata — usage field type (Issue #1211)', () => {
  it('usage field matches UsageStats interface shape when present', async () => {
    const {
      usage,
      resolvedUsage,
      usageFieldMatchesUsageStatsInterfaceShapeWhenPresentObservation1,
    } = await observeUsageFieldMatchesUsageStatsInterfaceShapeWhenPresent();
    expect(usage).toBeDefined();
    expect(typeof resolvedUsage.promptTokens).toBe('number');
    expect(typeof resolvedUsage.completionTokens).toBe('number');
    expect(typeof resolvedUsage.totalTokens).toBe('number');
    expect(
      usageFieldMatchesUsageStatsInterfaceShapeWhenPresentObservation1,
    ).toBe(true);
  });

  const observeUsageFieldMatchesUsageStatsInterfaceShapeWhenPresent =
    async () => {
      const ctx = buildContext();

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const usage = result.newHistory[result.top].metadata?.usage;

      const resolvedUsage = usage as UsageStats;

      const usageFieldMatchesUsageStatsInterfaceShapeWhenPresentObservation1 =
        resolvedUsage.cachedTokens === undefined ||
        typeof resolvedUsage.cachedTokens === 'number';
      return {
        usage,
        resolvedUsage,
        usageFieldMatchesUsageStatsInterfaceShapeWhenPresentObservation1,
      };
    };

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
      name: 'usage-stream-test-provider',
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

    const ctx = buildContext({ provider });

    const result = requireMiddleOutApplied(await compressMiddleOutViaDisk(ctx));
    const capturedUsage = result.newHistory[result.top].metadata?.usage;

    // Should capture the LAST (finalUsage), not the first
    expect(capturedUsage?.totalTokens).toBe(finalUsage.totalTokens);
    expect(capturedUsage?.promptTokens).toBe(finalUsage.promptTokens);
  });
});
