/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Independent in-memory reference for one-shot compression. Production
 * summarizes through OneShotStrategy.compressDisk; byte-equivalence tests
 * compare the disk route against this array implementation.
 */
import { readFileSync } from 'node:fs';
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
  PromptResolutionError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  adjustForToolCallBoundary,
  aggregateTextFromBlocks,
  bindCompressionProvider,
  buildTriggerInstruction,
  COMPRESSION_SECURITY_PREAMBLE,
  runVerificationPass,
  sanitizeHistoryForCompression,
} from '../../utils.js';
import { getCompressionPrompt } from '@vybestack/llxprt-code-core/core/prompts.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
import { buildTranscriptPathNotice } from '@vybestack/llxprt-code-core/core/compression/transcriptPathNotice.js';
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
      text: summary,
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
    const prompt = this.resolvePrompt(context);
    const triggerInstruction = buildTriggerInstruction(toCompress);
    return [
      COMPRESSION_SECURITY_PREAMBLE,
      { speaker: 'human', blocks: [{ type: 'text', text: prompt }] },
      ...sanitizeHistoryForCompression(toCompress),
      ...this.buildContextInjections(context),
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

  private resolvePrompt(context: Omit<CompressionContext, 'history'>): string {
    const resolved = context.promptResolver.resolveFile(
      context.promptBaseDir,
      'compression.md',
      context.promptContext,
    );

    if (resolved.found && resolved.path) {
      try {
        return readFileSync(resolved.path, 'utf-8');
      } catch {
        // Fall through to hardcoded default
      }
    }

    const fallback = getCompressionPrompt();
    if (!fallback) {
      throw new PromptResolutionError('compression.md');
    }
    return fallback;
  }

  private bindProvider(
    provider: IProvider,
    owner: ProviderRequestCollaborators,
  ): IProvider {
    return bindCompressionProvider(
      provider,
      owner.mediaResolver,
      owner.requestMediaBudgetBytes,
      owner.providerFileBindings,
      owner.providerFileLifecycle,
      owner.config?.getTargetDir(),
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
        resolvedRuntime,
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

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P23
   * @requirement REQ-HD-011.3, REQ-HD-012.2
   */
  private buildContextInjections(
    context: Omit<CompressionContext, 'history'>,
  ): IContent[] {
    const injections: IContent[] = [];

    if (context.activeTodos && context.activeTodos.trim().length > 0) {
      injections.push({
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: `The following are the current active todo/task items. When summarizing, preserve context about why each task exists and what has been tried:

${context.activeTodos}`,
          },
        ],
      });
    }

    if (context.transcriptPath) {
      injections.push({
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: buildTranscriptPathNotice(context.transcriptPath),
          },
        ],
      });
    }

    return injections;
  }
}
