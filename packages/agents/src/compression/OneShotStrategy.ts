import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  throwCompressionProviderFailure,
  withCompressionRequest,
} from './compressionAttempt.js';
import { bindCompressionProvider } from './utils.js';
import { summaryOutput, type SummaryOutput } from './summaryOutput.js';
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
  CompressionStrategy,
  StrategyTrigger,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  EmptySummaryError,
  PromptResolutionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { aggregateTextFromBlocks, runVerificationPass } from './utils.js';
import { getCompressionPrompt } from '@vybestack/llxprt-code-core/core/prompts.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
import { buildTranscriptPathNotice } from '@vybestack/llxprt-code-core/core/compression/transcriptPathNotice.js';
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

import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { diskSummaryRequestSelection } from './middleOutDiskPlan.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { adjustDiskToolBoundary } from './truncationDiskBoundary.js';

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

  readonly summaryRequestOwnership = new RowOwnership();

  async compressDisk(
    context: Omit<CompressionContext, 'history'> & {
      readonly history: CompressionInputRows;
    },
    candidate: HistoryDensityRows,
  ): Promise<
    | { readonly kind: 'applied'; readonly top: number }
    | { readonly kind: 'noop' }
  > {
    const result = await this.prepareDisk(context);
    if (result.kind === 'applied')
      for (let index = 0; index < result.candidate.length; index++)
        candidate.append(
          await result.candidate.readRow(index),
          await result.candidate.sourceOrdinalAt(index),
        );
    return result;
  }

  async prepareDisk(
    context: Omit<CompressionContext, 'history'> & {
      readonly history: CompressionInputRows;
    },
  ): Promise<SummaryOutput> {
    let bottom = Math.floor(
      context.history.length *
        (1 - context.runtimeContext.ephemerals.preserveThreshold()),
    );
    if (bottom < MINIMUM_COMPRESS_MESSAGES) return { kind: 'noop' };
    bottom = await adjustDiskToolBoundary(context.history, bottom);
    if (bottom < MINIMUM_COMPRESS_MESSAGES) return { kind: 'noop' };
    const result = destructureProviderResult(
      await context.resolveProvider(
        context.runtimeContext.ephemerals.compressionProfile(),
      ),
    );
    const request = diskSummaryRequestSelection(
      context.history,
      { top: 0, bottom, injection: [] },
      this.resolvePrompt(context),
      this.buildContextInjections(context),
      this.summaryRequestOwnership,
    );
    const {
      text: summary,
      usage,
      diagnostics,
    } = await this.callProvider(
      result.provider,
      request,
      context,
      result.resolvedRuntime,
      result.resolvedConfig,
      result.resolvedOptions,
      result.invocation,
    );
    if (!summary.trim()) throw new EmptySummaryError('one-shot', diagnostics);
    const finalSummary = await this.maybeVerifySummary(
      context,
      result.provider,
      summary,
      result.resolvedRuntime,
      result.resolvedConfig,
      result.resolvedOptions,
      result.invocation,
    );
    return summaryOutput(
      context.history,
      0,
      bottom,
      this.summaryRows(finalSummary, usage, context.activeTodos),
    );
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

  private summaryRows(
    finalSummary: string,
    capturedUsage: UsageStats | undefined,
    activeTodos: string | undefined,
  ): IContent[] {
    return [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: finalSummary }],
        metadata: {
          isSummary: true,
          synthetic: true,
          reason: 'compression-state-snapshot',
          ...(capturedUsage ? { usage: capturedUsage } : {}),
        },
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: buildContinuationDirective(activeTodos) },
        ],
        metadata: {
          synthetic: true,
          reason: 'compression-continuation',
        },
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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

    return withCompressionRequest(request, async () => {
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
            blockTypeCounts[block.type] =
              (blockTypeCounts[block.type] ?? 0) + 1;
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
        throwCompressionProviderFailure(this.name, error, invocation?.signal, {
          finishReason,
          rawStopReason,
          blockTypeCounts,
        });
      }
    });
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
