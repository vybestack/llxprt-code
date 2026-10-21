/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindCompressionProvider } from './utils.js';
import { summaryOutput, type SummaryOutput } from './summaryOutput.js';
/**
 * @plan PLAN-20260211-COMPRESSION.P06
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @plan PLAN-20260211-HIGHDENSITY.P05
 * @requirement REQ-CS-002.1, REQ-CS-002.2, REQ-CS-002.3, REQ-CS-002.4
 * @requirement REQ-CS-002.5, REQ-CS-002.6, REQ-CS-002.7, REQ-CS-002.8
 * @requirement REQ-HD-001.3
 * @pseudocode strategy-interface.md lines 70-74
 *
 * Middle-out compression strategy: preserves the top and bottom of the
 * conversation history and compresses the middle section via an LLM call.
 *
 * Extracted from the sandwich compression logic previously embedded in
 * ChatSession (getCompressionSplit, directCompressionCall, applyCompression).
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
  CompressionExecutionError,
  EmptySummaryError,
  PromptResolutionError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { aggregateTextFromBlocks, runVerificationPass } from './utils.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
import { buildTranscriptPathNotice } from '@vybestack/llxprt-code-core/core/compression/transcriptPathNotice.js';
import { getCompressionPrompt } from '@vybestack/llxprt-code-core/core/prompts.js';
import { buildCompressionChatOptions } from './compressionSystemPrompt.js';

import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  planDiskMiddleOut,
  diskSummaryRequestSelection,
} from './middleOutDiskPlan.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

// ---------------------------------------------------------------------------
// MiddleOutStrategy
// ---------------------------------------------------------------------------

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

export class MiddleOutStrategy implements CompressionStrategy {
  readonly name = 'middle-out' as const;
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
    const plan = await planDiskMiddleOut(context.history, context);
    if (plan === undefined) return { kind: 'noop' };
    const providerResult = destructureProviderResult(
      await context.resolveProvider(
        context.runtimeContext.ephemerals.compressionProfile(),
      ),
    );
    const { finalSummary, capturedUsage } = await this.compressAndVerify(
      context,
      diskSummaryRequestSelection(
        context.history,
        plan,
        this.resolvePrompt(context),
        this.buildContextInjections(context),
        this.summaryRequestOwnership,
      ),
      providerResult,
    );
    return summaryOutput(
      context.history,
      plan.top,
      plan.bottom,
      this.summaryRows(
        finalSummary,
        context.activeTodos,
        capturedUsage,
        plan.lastPromptContext,
      ),
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
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    );
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

    // Fall back to the hardcoded compression prompt
    const fallback = getCompressionPrompt();
    if (!fallback) {
      throw new PromptResolutionError('compression.md');
    }
    return fallback;
  }

  /**
   * Calls the provider, throws EmptySummaryError with diagnostics if the
   * summary is empty, then runs the optional verification pass.
   */
  private async compressAndVerify(
    context: Omit<CompressionContext, 'history'>,
    request: ProviderRequestSelection,
    providerResult: ReturnType<typeof destructureProviderResult>,
  ): Promise<{ finalSummary: string; capturedUsage: UsageStats | undefined }> {
    const {
      provider,
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    } = providerResult;

    const {
      text: summary,
      usage: capturedUsage,
      diagnostics,
    } = await this.callProvider(
      provider,
      request,
      context,
      resolvedRuntime,
      resolvedConfig,
      resolvedOptions,
      invocation,
    );

    if (!summary.trim()) {
      throw new EmptySummaryError('middle-out', diagnostics);
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

    return { finalSummary, capturedUsage };
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
          source: 'MiddleOutStrategy.callProvider',
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
        'middle-out',
        `LLM provider call failed: ${error instanceof Error ? error.message : String(error)} [partial diagnostics: finishReason=${finishReason ?? 'none'}, rawStopReason=${rawStopReason ?? 'none'}, blocks=${blocksSummary}]`,
        { isTransient: isTransientCompressionError(error) },
      );
    }
  }

  private summaryRows(
    summary: string,
    activeTodos?: string,
    usage?: UsageStats,
    lastUserPromptContext?: string,
  ): IContent[] {
    return [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: summary }],
        metadata: {
          isSummary: true,
          synthetic: true,
          reason: 'compression-state-snapshot',
          ...(usage ? { usage } : {}),
        },
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: buildContinuationDirective(
              activeTodos,
              lastUserPromptContext,
            ),
          },
        ],
        metadata: {
          synthetic: true,
          reason: 'compression-continuation',
        },
      },
    ];
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P23
   * @requirement REQ-HD-011.3, REQ-HD-012.2
   * @pseudocode prompts-todos.md lines 251-276
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
