/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Independent in-memory reference for one-shot compression. Production
 * summarizes through OneShotStrategy.compressDisk; byte-equivalence tests
 * compare the disk route against this array implementation.
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
  StrategyCompressionResult,
  StructuralNoopReason,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  CompressionExecutionError,
  EmptySummaryError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  adjustForToolCallBoundary,
  aggregateTextFromBlocks,
  bindCompressionProvider,
  buildContextInjections,
  buildSecurityPreamble,
  buildTriggerInstruction,
  runVerificationPass,
  sanitizeHistoryForCompression,
} from '../../utils.js';
import {
  COMPRESSION_PROMPT_FILES,
  loadCompressionPromptFile,
} from '@vybestack/llxprt-code-core/core/compression/compressionPromptFiles.js';
import { stripScratchpadSections } from '@vybestack/llxprt-code-core/services/history/compressionSummaryScratchpad.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
import { buildCompressionChatOptions } from '../../compressionSystemPrompt.js';
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

import {
  inMemoryRequestSelection,
  type ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

const MINIMUM_COMPRESS_MESSAGES = 4;

// ---------------------------------------------------------------------------
// OneShotArrayOracle
// ---------------------------------------------------------------------------

export class OneShotArrayOracle {
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
      inMemoryRequestSelection(compressionRequest),
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
    context: Omit<CompressionContext, 'history'>,
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
      undefined,
      undefined,
      undefined,
      undefined,
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
      undefined,
      undefined,
      undefined,
      undefined,
      config?.getTargetDir(),
    );
  }

  private async callProvider(
    provider: IProvider,
    request: ProviderRequestSelection,
    context: Omit<CompressionContext, 'history'>,
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
          requestRows: request,
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
