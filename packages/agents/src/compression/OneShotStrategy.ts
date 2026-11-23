import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindCompressionProvider } from './utils.js';
/**
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @plan PLAN-20260211-HIGHDENSITY.P05
 * @requirement REQ-HD-001.3
 * @pseudocode strategy-interface.md lines 90-94
 *
 * One-shot compression strategy: summarizes the entire history except
 * the last N messages in a single LLM call. The preserved tail is
 * determined by the preserveThreshold ephemeral setting.
 *
 * Unlike middle-out (which preserves both top and bottom), one-shot
 * preserves ONLY the recent tail. The summary replaces everything
 * above the preserved messages.
 */

import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  CompressionContext,
  CompressionProviderResult,
  CompressionResultMetadata,
  CompressionStrategy,
  StrategyCompressionResult,
  StructuralNoopReason,
  StrategyTrigger,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  CompressionExecutionError,
  EmptySummaryError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  adjustForToolCallBoundary,
  aggregateTextFromBlocks,
  buildTriggerInstruction,
  buildContextInjections,
  buildSecurityPreamble,
  runVerificationPass,
  sanitizeHistoryForCompression,
} from './utils.js';
import {
  COMPRESSION_PROMPT_FILES,
  loadCompressionPromptFile,
} from '@vybestack/llxprt-code-core/core/compression/compressionPromptFiles.js';
import { stripScratchpadSections } from '@vybestack/llxprt-code-core/services/history/compressionSummaryScratchpad.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
import { buildCompressionChatOptions } from './compressionSystemPrompt.js';
function destructureProviderResult(result: CompressionProviderResult): {
  provider: IProvider;
  resolvedRuntime: ProviderRequestCollaborators;
  resolvedConfig?: Config;
  resolvedOptions?: RuntimeGenerateChatOptions['resolved'];
  invocation?: RuntimeGenerateChatOptions['invocation'];
} {
  return {
    provider: result.provider,
    resolvedRuntime: result.runtime,
    resolvedConfig: result.config,
    resolvedOptions: result.resolved,
    invocation: result.invocation,
  };
}

const MINIMUM_COMPRESS_MESSAGES = 4;

// ---------------------------------------------------------------------------
// OneShotStrategy
// ---------------------------------------------------------------------------

export class OneShotStrategy implements CompressionStrategy {
  constructor(
    private readonly mediaResolver: RequestMediaResolutionService | undefined,
    private readonly requestMediaBudgetBytes: number | undefined,
    private readonly providerFileBindings: ProviderFileBindingStore | undefined,
    private readonly providerFileLifecycle: ProviderFileLifecycle | undefined,
  ) {}

  readonly name = 'one-shot' as const;
  readonly requiresLLM = true;
  /** @plan PLAN-20260211-HIGHDENSITY.P03 @requirement REQ-HD-001.3 */
  readonly trigger: StrategyTrigger = {
    mode: 'threshold',
    defaultThreshold: 0.85,
  };

  async compress(
    context: CompressionContext,
  ): Promise<StrategyCompressionResult> {
    const { history } = context;

    if (history.length === 0) {
      return this.structuralNoop(history, 'empty-history');
    }

    const { toCompress, toKeep } = this.computeSplit(context);

    if (toCompress.length < MINIMUM_COMPRESS_MESSAGES) {
      return this.structuralNoop(history, 'too-few-compressible');
    }

    const compressionProfile =
      context.runtimeContext.ephemerals.compressionProfile();
    const {
      provider,
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    } = destructureProviderResult(
      await context.resolveProvider(compressionProfile),
    );

    const compressionRequest = this.buildCompressionRequest(
      context,
      toCompress,
    );

    const {
      text: rawSummary,
      usage: capturedUsage,
      diagnostics,
    } = await this.callProvider(
      provider,
      compressionRequest,
      context,
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    );

    const summary = stripScratchpadSections(rawSummary);
    if (!summary.trim()) {
      throw new EmptySummaryError('one-shot', diagnostics);
    }

    const finalSummary = await this.maybeVerifySummary(
      context,
      provider,
      summary,
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    );

    return this.assembleResult(
      history,
      toKeep,
      toCompress,
      finalSummary,
      capturedUsage,
      context.activeTodos,
      provider.name,
      resolvedOptions?.model ?? null,
    );
  }

  private buildCompressionRequest(
    context: CompressionContext,
    toCompress: IContent[],
  ): IContent[] {
    const prompt = loadCompressionPromptFile(
      context,
      COMPRESSION_PROMPT_FILES.instructions,
    );
    const triggerInstruction = buildTriggerInstruction(context, toCompress);
    return [
      buildSecurityPreamble(context),
      { speaker: 'human', blocks: [{ type: 'text', text: prompt }] },
      ...sanitizeHistoryForCompression(toCompress),
      ...buildContextInjections(context),
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: triggerInstruction }],
      },
    ];
  }

  private async maybeVerifySummary(
    context: CompressionContext,
    provider: IProvider,
    summary: string,
    resolvedRuntime: ProviderRequestCollaborators,
    resolvedConfig: Config | undefined,
    resolvedOptions: RuntimeGenerateChatOptions['resolved'] | undefined,
    invocation: RuntimeGenerateChatOptions['invocation'] | undefined,
  ): Promise<string> {
    if (context.compressionVerification !== true) {
      return summary;
    }
    return runVerificationPass(
      provider,
      summary,
      context,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    );
  }

  private assembleResult(
    history: readonly IContent[],
    toKeep: IContent[],
    toCompress: IContent[],
    finalSummary: string,
    capturedUsage: UsageStats | undefined,
    activeTodos: string | undefined,
    summaryAuthorProvider: string,
    summaryAuthorModel: string | null,
  ): StrategyCompressionResult {
    const summaryEntry: IContent = {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: finalSummary }],
      metadata: {
        isSummary: true,
        synthetic: true,
        reason: 'compression-state-snapshot',
        ...(capturedUsage ? { usage: capturedUsage } : {}),
      },
    };

    const newHistory: IContent[] = [
      summaryEntry,
      {
        speaker: 'ai' as const,
        blocks: [
          {
            type: 'text' as const,
            text: buildContinuationDirective(activeTodos),
          },
        ],
        metadata: {
          synthetic: true,
          reason: 'compression-continuation',
        },
      },
      ...toKeep,
    ];

    const metadata: CompressionResultMetadata = {
      originalMessageCount: history.length,
      compressedMessageCount: newHistory.length,
      strategyUsed: 'one-shot',
      llmCallMade: true,
      topPreserved: 0,
      bottomPreserved: toKeep.length,
      middleCompressed: toCompress.length,
      auditProvenance: {
        summaryAuthorModel,
        summaryAuthorProvider,
        compressionStrategy: 'one-shot',
      },
      ...(capturedUsage ? { usage: capturedUsage } : {}),
    };

    return { kind: 'applied', newHistory, metadata };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private computeSplit(context: CompressionContext): {
    toCompress: IContent[];
    toKeep: IContent[];
  } {
    const history = context.history as IContent[];
    const preserveThreshold =
      context.runtimeContext.ephemerals.preserveThreshold();

    let splitIndex = Math.floor(history.length * (1 - preserveThreshold));

    if (splitIndex < MINIMUM_COMPRESS_MESSAGES) {
      return { toCompress: [], toKeep: [...history] };
    }

    splitIndex = adjustForToolCallBoundary(history, splitIndex);

    if (splitIndex < MINIMUM_COMPRESS_MESSAGES) {
      return { toCompress: [], toKeep: [...history] };
    }

    return {
      toCompress: history.slice(0, splitIndex),
      toKeep: history.slice(splitIndex),
    };
  }

  private bindProvider(
    provider: IProvider,
    config: Config | undefined,
  ): IProvider {
    return bindCompressionProvider(
      provider,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      config?.getTargetDir(),
    );
  }

  private async callProvider(
    provider: IProvider,
    request: IContent[],
    context: CompressionContext,
    resolvedRuntime: ProviderRequestCollaborators,
    resolvedConfig: Config | undefined,
    resolvedOptions: RuntimeGenerateChatOptions['resolved'] | undefined,
    invocation: RuntimeGenerateChatOptions['invocation'] | undefined,
  ): Promise<{
    text: string;
    usage?: UsageStats;
    diagnostics: {
      finishReason?: string;
      rawStopReason?: string;
      blockTypeCounts?: Record<string, number>;
    };
  }> {
    // Declared above the try block so partial diagnostics are available
    // to the catch handler when a mid-stream error interrupts the loop.
    let summary = '';
    let lastBlockWasNonText = false;
    let capturedUsage: UsageStats | undefined;
    let finishReason: string | undefined;
    let rawStopReason: string | undefined;
    const blockTypeCounts: Record<string, number> = {};

    try {
      const stream = this.bindProvider(
        provider,
        resolvedConfig,
      ).generateChatCompletion(
        await buildCompressionChatOptions({
          contents: request,
          providerRuntime: resolvedRuntime,
          resolvedConfig,
          fallbackConfig: context.config,
          resolvedOptions,
          invocation,
          fallbackModel: context.runtimeState.model,
          runtimeState: context.runtimeState,
          provider,
          modelParameters: context.modelParameters,
          source: 'OneShotStrategy.callProvider',
        }),
      );

      for await (const chunk of stream) {
        for (const block of chunk.blocks) {
          blockTypeCounts[block.type] = (blockTypeCounts[block.type] ?? 0) + 1;
        }
        const result = aggregateTextFromBlocks(
          chunk.blocks,
          summary,
          lastBlockWasNonText,
        );
        summary = result.text;
        lastBlockWasNonText = result.lastBlockWasNonText;
        if (chunk.metadata?.usage) {
          capturedUsage = chunk.metadata.usage;
        }
        if (chunk.metadata?.finishReason) {
          finishReason = chunk.metadata.finishReason;
        }
        if (chunk.metadata?.rawStopReason) {
          rawStopReason = chunk.metadata.rawStopReason;
        }
      }

      return {
        text: summary,
        usage: capturedUsage,
        diagnostics: { finishReason, rawStopReason, blockTypeCounts },
      };
    } catch (error) {
      const blocksSummary =
        Object.entries(blockTypeCounts)
          .map(([type, count]) => `${type}:${count}`)
          .join(',') || 'none';
      throw new CompressionExecutionError(
        'one-shot',
        `LLM provider call failed: ${error instanceof Error ? error.message : String(error)} [partial diagnostics: finishReason=${finishReason ?? 'none'}, rawStopReason=${rawStopReason ?? 'none'}, blocks=${blocksSummary}]`,
        { isTransient: isTransientCompressionError(error) },
      );
    }
  }

  private structuralNoop(
    history: readonly IContent[],
    reason: StructuralNoopReason,
  ): StrategyCompressionResult {
    return {
      kind: 'noop',
      reason,
      metadata: {
        originalMessageCount: history.length,
        compressedMessageCount: history.length,
        strategyUsed: 'one-shot',
        llmCallMade: false,
        topPreserved: 0,
        bottomPreserved: 0,
        middleCompressed: 0,
      },
    };
  }
}
