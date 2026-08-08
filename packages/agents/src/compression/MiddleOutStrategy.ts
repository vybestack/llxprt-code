/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
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
  PromptResolutionError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  adjustForToolCallBoundary,
  aggregateTextFromBlocks,
  findForwardValidSplitPoint,
  buildTriggerInstruction,
  COMPRESSION_SECURITY_PREAMBLE,
  runVerificationPass,
  sanitizeHistoryForCompression,
  mediaBlockToCompressionPlaceholder,
} from './utils.js';
import { buildContinuationDirective } from '@vybestack/llxprt-code-core/core/compression/continuationDirective.js';
import { getCompressionPrompt } from '@vybestack/llxprt-code-core/core/prompts.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { buildCompressionChatOptions } from './compressionSystemPrompt.js';

const MINIMUM_MIDDLE_MESSAGES = 4;
const LAST_PROMPT_TOKEN_THRESHOLD = 500;
const LAST_PROMPT_CONTEXT_MAX_LENGTH = 200;

// ---------------------------------------------------------------------------
// MiddleOutStrategy
// ---------------------------------------------------------------------------

function destructureProviderResult(result: CompressionProviderResult): {
  provider: IProvider;
  resolvedRuntime: ProviderRuntimeContext;
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

  async compress(
    context: CompressionContext,
  ): Promise<StrategyCompressionResult> {
    const { history } = context;

    if (history.length === 0) {
      return this.structuralNoop(history, 'empty-history');
    }

    let { toKeepTop, toCompress, toKeepBottom } = this.computeSplit(context);

    if (toCompress.length < MINIMUM_MIDDLE_MESSAGES) {
      return this.structuralNoop(history, 'too-few-compressible', {
        toKeepTop,
        toKeepBottom,
        middleCompressed: toCompress.length,
      });
    }

    const {
      toCompress: adjustedCompress,
      toKeepBottom: adjustedBottom,
      lastUserPromptContext,
      largeLastPromptInjection,
    } = this.preserveLastUserPrompt(toKeepTop, toCompress, toKeepBottom);
    toCompress = adjustedCompress;
    toKeepBottom = adjustedBottom;

    if (toCompress.length < MINIMUM_MIDDLE_MESSAGES) {
      return this.structuralNoop(history, 'shrunk-below-minimum', {
        toKeepTop,
        toKeepBottom,
        middleCompressed: 0,
      });
    }

    const compressionProfile =
      context.runtimeContext.ephemerals.compressionProfile();
    const providerResult = destructureProviderResult(
      await context.resolveProvider(compressionProfile),
    );

    const compressionRequest = this.buildCompressionRequest(
      context,
      toCompress,
      largeLastPromptInjection,
    );

    const { finalSummary, capturedUsage } = await this.compressAndVerify(
      context,
      compressionRequest,
      providerResult,
    );

    const newHistory = this.assembleHistory(
      toKeepTop,
      finalSummary,
      toKeepBottom,
      context.activeTodos,
      capturedUsage,
      lastUserPromptContext,
    );

    const metadata = this.buildMetadata(
      history,
      newHistory,
      toKeepTop,
      toCompress,
      toKeepBottom,
      capturedUsage,
    );

    return { kind: 'applied', newHistory, metadata };
  }

  private buildCompressionRequest(
    context: CompressionContext,
    toCompress: IContent[],
    largeLastPromptInjection: IContent[],
  ): IContent[] {
    const prompt = this.resolvePrompt(context);
    const triggerInstruction = buildTriggerInstruction(toCompress);
    return [
      COMPRESSION_SECURITY_PREAMBLE,
      { speaker: 'human', blocks: [{ type: 'text', text: prompt }] },
      ...sanitizeHistoryForCompression(toCompress),
      ...this.buildContextInjections(context),
      ...largeLastPromptInjection,
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
    resolvedRuntime: ProviderRuntimeContext,
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

  private buildMetadata(
    history: readonly IContent[],
    newHistory: IContent[],
    toKeepTop: IContent[],
    toCompress: IContent[],
    toKeepBottom: IContent[],
    capturedUsage: UsageStats | undefined,
  ): CompressionResultMetadata {
    return {
      originalMessageCount: history.length,
      compressedMessageCount: newHistory.length,
      strategyUsed: 'middle-out',
      llmCallMade: true,
      topPreserved: toKeepTop.length,
      bottomPreserved: toKeepBottom.length,
      middleCompressed: toCompress.length,
      ...(capturedUsage ? { usage: capturedUsage } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private computeSplit(context: CompressionContext): {
    toKeepTop: IContent[];
    toCompress: IContent[];
    toKeepBottom: IContent[];
  } {
    const history = context.history as IContent[];
    const preserveThreshold =
      context.runtimeContext.ephemerals.preserveThreshold();
    const topPreserveThreshold =
      context.runtimeContext.ephemerals.topPreserveThreshold();

    let topSplitIndex = this.resolveTopSplitIndex(
      history,
      topPreserveThreshold,
      context.cacheAnchorSeq ?? 0,
    );
    const anchorFloor = topSplitIndex;
    let bottomSplitIndex = Math.floor(history.length * (1 - preserveThreshold));

    if (bottomSplitIndex - topSplitIndex < MINIMUM_MIDDLE_MESSAGES) {
      return { toKeepTop: [...history], toCompress: [], toKeepBottom: [] };
    }

    topSplitIndex = adjustForToolCallBoundary(history, topSplitIndex);
    // The tool-boundary adjustment can move the index BACKWARD (forward scan
    // returns index-1; backward scan can go arbitrarily far back). If it drops
    // below the anchor floor, search FORWARD for the next valid split point at
    // or above the floor so the cacheable prefix invariant is never broken
    // (#3070 Defect 4). If no valid split at or above the floor exists, return
    // a clean structural no-op rather than silently dropping below the floor.
    if (topSplitIndex < anchorFloor) {
      topSplitIndex = this.findValidSplitAtOrAboveFloor(history, anchorFloor);
      if (topSplitIndex === -1) {
        return { toKeepTop: [...history], toCompress: [], toKeepBottom: [] };
      }
    }
    bottomSplitIndex = adjustForToolCallBoundary(history, bottomSplitIndex);

    if (
      topSplitIndex >= bottomSplitIndex ||
      bottomSplitIndex - topSplitIndex < MINIMUM_MIDDLE_MESSAGES
    ) {
      return { toKeepTop: [...history], toCompress: [], toKeepBottom: [] };
    }

    return {
      toKeepTop: history.slice(0, topSplitIndex),
      toCompress: history.slice(topSplitIndex, bottomSplitIndex),
      toKeepBottom: history.slice(bottomSplitIndex),
    };
  }

  /**
   * Resolve the top (preserved-head) split index, applying the monotonic cache
   * anchor floor so the preserved head never shrinks across successive
   * compressions (#3070).
   *
   * The base index is `ceil(N * topPreserveThreshold)`. The anchor raises it to
   * `anchorIndex + 1`, where `anchorIndex` is the index of the history entry
   * whose chronology `seq` is EXACTLY `cacheAnchorSeq`. The match is by exact
   * identity, not a `<=` threshold scan, because the compression rebuild
   * re-adds preserved TAIL entries that keep their ORIGINAL low seqs while the
   * freshly minted summary/continuation get the HIGHEST seqs and sit in the
   * MIDDLE of the array — so the array is NOT sorted by seq and a backward
   * `<=` scan would match a low-seq TAIL entry at a high index (#3070 Defect 2).
   * When no entry matches exactly there is no floor; fall back to the base
   * fractional split. An anchor at or beyond the whole history degrades to a
   * split past the end, which the caller's structural no-op guards turn into a
   * clean no-op.
   */
  private resolveTopSplitIndex(
    history: readonly IContent[],
    topPreserveThreshold: number,
    cacheAnchorSeq: number,
  ): number {
    const baseSplitIndex = Math.ceil(history.length * topPreserveThreshold);

    if (cacheAnchorSeq <= 0) {
      return baseSplitIndex;
    }

    let anchorIndex = -1;
    for (let i = 0; i < history.length; i++) {
      const seq = history[i].metadata?.chronology?.seq;
      if (seq === cacheAnchorSeq) {
        anchorIndex = i;
        break;
      }
    }

    if (anchorIndex === -1) {
      return baseSplitIndex;
    }

    return Math.max(baseSplitIndex, anchorIndex + 1);
  }

  /**
   * Search forward from the anchor floor for the next valid split point that
   * does not land inside a tool-call/response pair. The canonical utility may
   * move a candidate backward, so candidates below the floor are skipped.
   */
  private findValidSplitAtOrAboveFloor(
    history: readonly IContent[],
    floor: number,
  ): number {
    const candidateHistory = [...history];
    for (let candidate = floor; candidate <= history.length; candidate++) {
      const adjusted = findForwardValidSplitPoint(candidateHistory, candidate);
      if (adjusted >= floor) {
        return adjusted;
      }
    }
    return -1;
  }

  private resolvePrompt(context: CompressionContext): string {
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
    context: CompressionContext,
    request: IContent[],
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

  private async callProvider(
    provider: IProvider,
    request: IContent[],
    context: CompressionContext,
    resolvedRuntime: ProviderRuntimeContext,
    resolvedConfig: Config | undefined,
    resolvedOptions: RuntimeGenerateChatOptions['resolved'] | undefined,
    invocation: RuntimeGenerateChatOptions['invocation'] | undefined,
  ): Promise<{
    text: string;
    usage?: UsageStats;
    diagnostics: {
      finishReason?: string;
      stopReason?: string;
      blockTypeCounts?: Record<string, number>;
    };
  }> {
    const providerRuntime = resolvedRuntime;
    // Declared above the try block so partial diagnostics are available
    // to the catch handler when a mid-stream error interrupts the loop.
    let summary = '';
    let lastBlockWasNonText = false;
    let capturedUsage: UsageStats | undefined;
    let finishReason: string | undefined;
    let stopReason: string | undefined;
    const blockTypeCounts: Record<string, number> = {};

    try {
      const stream = provider.generateChatCompletion(
        await buildCompressionChatOptions({
          contents: request,
          providerRuntime,
          resolvedConfig,
          fallbackConfig: context.config,
          resolvedOptions,
          invocation,
          fallbackModel: context.runtimeState.model,
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
        if (chunk.metadata?.stopReason) {
          stopReason = chunk.metadata.stopReason;
        }
      }

      return {
        text: summary,
        usage: capturedUsage,
        diagnostics: { finishReason, stopReason, blockTypeCounts },
      };
    } catch (error) {
      const blocksSummary =
        Object.entries(blockTypeCounts)
          .map(([type, count]) => `${type}:${count}`)
          .join(',') || 'none';
      throw new CompressionExecutionError(
        'middle-out',
        `LLM provider call failed: ${error instanceof Error ? error.message : String(error)} [partial diagnostics: finishReason=${finishReason ?? 'none'}, stopReason=${stopReason ?? 'none'}, blocks=${blocksSummary}]`,
        { isTransient: isTransientCompressionError(error) },
      );
    }
  }

  private preserveLastUserPrompt(
    toKeepTop: readonly IContent[],
    toCompress: readonly IContent[],
    toKeepBottom: readonly IContent[],
  ): {
    toCompress: IContent[];
    toKeepBottom: IContent[];
    lastUserPromptContext: string | undefined;
    largeLastPromptInjection: IContent[];
  } {
    const fullHistory = [...toKeepTop, ...toCompress, ...toKeepBottom];
    const lastHumanIndex = this.findLastHumanMessageIndex(fullHistory);

    if (lastHumanIndex === -1) {
      return {
        toCompress: [...toCompress],
        toKeepBottom: [...toKeepBottom],
        lastUserPromptContext: undefined,
        largeLastPromptInjection: [],
      };
    }

    const compressStart = toKeepTop.length;
    const compressEnd = compressStart + toCompress.length;
    const isInCompressRange =
      lastHumanIndex >= compressStart && lastHumanIndex < compressEnd;

    if (!isInCompressRange) {
      const lastHumanMsg = fullHistory[lastHumanIndex];
      const text = this.extractTextFromMessage(lastHumanMsg);
      const context =
        text.length > LAST_PROMPT_CONTEXT_MAX_LENGTH
          ? text.slice(0, LAST_PROMPT_CONTEXT_MAX_LENGTH) + '...'
          : text;
      return {
        toCompress: [...toCompress],
        toKeepBottom: [...toKeepBottom],
        lastUserPromptContext: context || undefined,
        largeLastPromptInjection: [],
      };
    }

    const lastHumanMsg = fullHistory[lastHumanIndex];
    const messageText = this.extractTextFromMessage(lastHumanMsg);
    const tokenCount = estimateTokens(messageText);
    const indexInCompress = lastHumanIndex - compressStart;

    if (tokenCount < LAST_PROMPT_TOKEN_THRESHOLD) {
      const movedMessages = toCompress.slice(indexInCompress);
      const remainingCompress = toCompress.slice(0, indexInCompress);
      const context =
        messageText.length > LAST_PROMPT_CONTEXT_MAX_LENGTH
          ? messageText.slice(0, LAST_PROMPT_CONTEXT_MAX_LENGTH) + '...'
          : messageText;
      return {
        toCompress: [...remainingCompress],
        toKeepBottom: [...movedMessages, ...toKeepBottom],
        lastUserPromptContext: context || undefined,
        largeLastPromptInjection: [],
      };
    }

    const context =
      messageText.length > LAST_PROMPT_CONTEXT_MAX_LENGTH
        ? messageText.slice(0, LAST_PROMPT_CONTEXT_MAX_LENGTH) + '...'
        : messageText;
    const injection: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: `IMPORTANT — The user's most recent message (summarized because it was too long to preserve literally). Summarize this user request faithfully and completely, preserving their exact intent, problems described, and any specific instructions:

${messageText}`,
        },
      ],
    };
    return {
      toCompress: [...toCompress],
      toKeepBottom: [...toKeepBottom],
      lastUserPromptContext: context || undefined,
      largeLastPromptInjection: [injection],
    };
  }

  private findLastHumanMessageIndex(history: readonly IContent[]): number {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].speaker === 'human') {
        return i;
      }
    }
    return -1;
  }

  private extractTextFromMessage(message: IContent): string {
    return message.blocks
      .map((block) => {
        if (block.type === 'text') {
          return block.text;
        }
        if (block.type === 'media') {
          return mediaBlockToCompressionPlaceholder(block);
        }
        return '';
      })
      .filter((text) => text.length > 0)
      .join(' ');
  }

  private assembleHistory(
    toKeepTop: IContent[],
    summary: string,
    toKeepBottom: IContent[],
    activeTodos?: string,
    usage?: UsageStats,
    lastUserPromptContext?: string,
  ): IContent[] {
    const summaryEntry: IContent = {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: summary }],
      metadata: {
        isSummary: true,
        synthetic: true,
        reason: 'compression-state-snapshot',
        ...(usage ? { usage } : {}),
      },
    };

    return [
      ...toKeepTop,
      summaryEntry,
      {
        speaker: 'ai' as const,
        blocks: [
          {
            type: 'text' as const,
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
      ...toKeepBottom,
    ];
  }

  private structuralNoop(
    history: readonly IContent[],
    reason: StructuralNoopReason,
    split?: {
      toKeepTop: readonly IContent[];
      toKeepBottom: readonly IContent[];
      middleCompressed: number;
    },
  ): StrategyCompressionResult {
    return {
      kind: 'noop',
      reason,
      metadata: {
        originalMessageCount: history.length,
        compressedMessageCount: history.length,
        strategyUsed: 'middle-out',
        llmCallMade: false,
        topPreserved: split?.toKeepTop.length ?? 0,
        bottomPreserved: split?.toKeepBottom.length ?? 0,
        middleCompressed: split?.middleCompressed ?? 0,
      },
    };
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P23
   * @requirement REQ-HD-011.3, REQ-HD-012.2
   * @pseudocode prompts-todos.md lines 251-276
   */
  private buildContextInjections(context: CompressionContext): IContent[] {
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
            text: `Note: The full pre-compression transcript is available at: ${context.transcriptPath}`,
          },
        ],
      });
    }

    return injections;
  }
}
