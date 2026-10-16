/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Independent in-memory reference for deterministic high-density compression.
 * Production compresses through HighDensityStrategy.compressDisk;
 * byte-equivalence tests compare the disk route against this array
 * implementation.
 */
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  CompressionResultMetadata,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { RERUN_HINT_SUFFIX } from '../../HighDensityStrategy.js';
import { findKeyParamForCallId } from './density-array-lookup.js';

export class HighDensityArrayOracle {
  async compress(
    context: CompressionContext,
  ): Promise<StrategyCompressionResult> {
    const history = context.history;
    const originalCount = history.length;

    if (originalCount === 0) {
      return {
        kind: 'noop',
        reason: 'empty-history',
        metadata: this.buildMetadata(0, 0),
      };
    }

    // STEP 1: Calculate tail size from preserveThreshold (@pseudocode lines 21-27)
    const preserveThreshold =
      context.runtimeContext.ephemerals.preserveThreshold();
    const tailSize = Math.max(1, Math.floor(originalCount * preserveThreshold));
    let tailStartIndex = originalCount - tailSize;

    // Adjust for tool_call boundary — expand tail backward to avoid splitting pairs
    tailStartIndex = this.adjustTailBoundary(history, tailStartIndex);

    // If tail covers everything, return history unchanged (@pseudocode lines 29-34)
    if (tailStartIndex <= 0) {
      return {
        kind: 'noop',
        reason: 'tail-covers-all',
        metadata: this.buildMetadata(originalCount, originalCount),
      };
    }

    // STEP 2: Calculate target tokens (@pseudocode lines 36-39)
    const compressionThreshold =
      context.runtimeContext.ephemerals.compressionThreshold();
    const contextLimit = context.runtimeContext.ephemerals.contextLimit();
    const compressHeadroom =
      context.runtimeContext.ephemerals.densityCompressHeadroom();
    const targetTokens = Math.floor(
      compressionThreshold * contextLimit * compressHeadroom,
    );

    context.logger.debug(
      `[HighDensity compress] originalCount=${originalCount} tailStart=${tailStartIndex} target=${targetTokens}`,
    );

    // STEP 3: Build new history — process head + preserve tail (@pseudocode lines 48-74)
    const newHistory: IContent[] = [];

    // 3a: Process entries before tail
    for (let i = 0; i < tailStartIndex; i++) {
      const entry = history[i];
      if (entry.speaker === 'human' || entry.speaker === 'ai') {
        // Preserve human and AI entries intact (REQ-HD-008.4)
        newHistory.push(entry);
      } else {
        // Summarize tool response blocks (REQ-HD-008.3)
        const summarized = this.summarizeToolResponseBlocks(entry, history);
        newHistory.push(summarized);
      }
    }

    // 3b: Push tail entries intact (REQ-HD-008.2)
    for (let i = tailStartIndex; i < originalCount; i++) {
      newHistory.push(history[i]);
    }

    // STEP 4: Truncate if still over target (@pseudocode lines 76-85)
    const finalHistory = await this.truncateToTarget(
      newHistory,
      newHistory.length - (originalCount - tailStartIndex),
      targetTokens,
      context,
    );

    // STEP 5: Return result (@pseudocode lines 87-91)
    return {
      kind: 'applied',
      newHistory: finalHistory,
      metadata: this.buildMetadata(originalCount, finalHistory.length),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers — compress phase
  // -------------------------------------------------------------------------

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.2
   * @pseudocode high-density-compress.md line 27
   *
   * Adjust the tail boundary backward to avoid splitting tool_call/response
   * pairs. If the boundary lands on a tool_response, move it back to include
   * the preceding AI tool_call entry as well.
   */
  private adjustTailBoundary(
    history: readonly IContent[],
    index: number,
  ): number {
    if (index <= 0 || index >= history.length) return index;
    while (index > 0 && history[index].speaker === 'tool') index--;
    if (index > 0 && history[index].speaker === 'ai') {
      const toolCallIds = history[index].blocks
        .filter((b): b is ToolCallBlock => b.type === 'tool_call')
        .map((b) => b.id);
      if (toolCallIds.length > 0) {
        const tailHasResponses = toolCallIds.some((id) =>
          history
            .slice(index + 1)
            .some(
              (e) =>
                e.speaker === 'tool' &&
                e.blocks.some(
                  (b) => b.type === 'tool_response' && b.callId === id,
                ),
            ),
        );
        if (!tailHasResponses) index++;
      }
    }
    return index;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.3
   * @pseudocode high-density-compress.md lines 100-112
   *
   * Replace tool_response block results with compact one-line summaries.
   * Non-tool_response blocks are passed through unchanged.
   */
  private summarizeToolResponseBlocks(
    entry: IContent,
    fullHistory: readonly IContent[],
  ): IContent {
    return {
      ...entry,
      blocks: entry.blocks.map((block) =>
        block.type !== 'tool_response'
          ? block
          : ({
              ...block,
              result: this.buildToolSummaryText(block, fullHistory),
            } as ToolResponseBlock),
      ),
    } as IContent;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.3
   * @pseudocode high-density-compress.md lines 120-149
   *
   * Build a compact summary string for a tool response block.
   * Format: `[toolName keyParam: status]`
   */
  private buildToolSummaryText(
    block: ToolResponseBlock,
    fullHistory: readonly IContent[],
  ): string {
    const toolName = block.toolName;

    // Determine status: error if error field present or result contains error indicators
    const hasError = block.error !== undefined && block.error !== '';
    const resultStr =
      typeof block.result === 'string'
        ? block.result
        : JSON.stringify(block.result ?? '');
    const looksLikeError =
      !hasError &&
      (resultStr.toLowerCase().includes('error:') ||
        resultStr.toLowerCase().includes('error occurred') ||
        resultStr.toLowerCase().includes('command failed'));
    const outcome = hasError || looksLikeError ? 'error' : 'success';

    // Extract key param — look for matching tool_call by callId
    const keyParam = findKeyParamForCallId(fullHistory, block.callId);

    if (keyParam) {
      return `[${toolName} ${keyParam}: ${outcome} ${RERUN_HINT_SUFFIX}]`;
    }
    return `[${toolName}: ${outcome} ${RERUN_HINT_SUFFIX}]`;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.6
   * @pseudocode high-density-compress.md lines 155-175
   *
   * Remove oldest head entries until the estimated token count is
   * at or below the target. Never removes tail entries.
   */
  private async truncateToTarget(
    history: IContent[],
    headEnd: number,
    targetTokens: number,
    context: CompressionContext,
  ): Promise<IContent[]> {
    let removeCount = 0;
    let estimatedTokens = await context.estimateTokens(history);

    while (estimatedTokens > targetTokens && removeCount < headEnd) {
      removeCount++;
      estimatedTokens = await context.estimateTokens(
        history.slice(removeCount),
      );
    }

    return removeCount > 0 ? history.slice(removeCount) : history;
  }

  /** @plan PLAN-20260211-HIGHDENSITY.P14 @requirement REQ-HD-008.5 */
  private buildMetadata(
    originalMessageCount: number,
    compressedMessageCount: number,
  ): CompressionResultMetadata {
    return {
      originalMessageCount,
      compressedMessageCount,
      strategyUsed: 'high-density',
      llmCallMade: false,
    };
  }
}
