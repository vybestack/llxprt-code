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
import { summarizerProvenance } from './compressionAuditProvenance.js';
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
import { EmptySummaryError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  aggregateTextFromBlocks,
  buildContextInjections,
  buildSummaryRequestFrame,
  runVerificationPass,
} from './utils.js';
import { stripScratchpadSections } from '@vybestack/llxprt-code-core/services/history/compressionSummaryScratchpad.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
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
  constructor(
    private readonly mediaResolver: RequestMediaResolutionService | undefined,
    private readonly requestMediaBudgetBytes: number | undefined,
    private readonly providerFileBindings: ProviderFileBindingStore | undefined,
    private readonly providerFileLifecycle: ProviderFileLifecycle | undefined,
  ) {}

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
        buildSummaryRequestFrame(context),
        buildContextInjections(context),
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
      summarizerProvenance(
        'middle-out',
        providerResult.provider.name,
        providerResult.resolvedOptions?.model ?? null,
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
      text: rawSummary,
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

    const summary = stripScratchpadSections(rawSummary);
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
            source: 'MiddleOutStrategy.callProvider',
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
}
