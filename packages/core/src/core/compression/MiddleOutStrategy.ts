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
 * GeminiChat (getCompressionSplit, directCompressionCall, applyCompression).
 */

import { readFileSync } from 'node:fs';
import type {
  IContent,
  TextBlock,
  UsageStats,
} from '../../services/history/IContent.js';
import type { IProvider } from '../../providers/IProvider.js';
import type {
  CompressionContext,
  CompressionResult,
  CompressionResultMetadata,
  CompressionStrategy,
  StrategyTrigger,
} from './types.js';
import {
  CompressionExecutionError,
  PromptResolutionError,
  isTransientCompressionError,
} from './types.js';
import {
  adjustForToolCallBoundary,
  aggregateTextFromBlocks,
  buildContinuationDirective,
  sanitizeHistoryForCompression,
} from './utils.js';
import { getCompressionPrompt } from '../prompts.js';
import { estimateTokens } from '../../utils/toolOutputLimiter.js';

const MINIMUM_MIDDLE_MESSAGES = 4;
const LAST_PROMPT_TOKEN_THRESHOLD = 500;
const LAST_PROMPT_CONTEXT_MAX_LENGTH = 200;

const TRIGGER_INSTRUCTION =
  'First, reason in your scratchpad. Then, generate the <state_snapshot>.';

// ---------------------------------------------------------------------------
// MiddleOutStrategy
// ---------------------------------------------------------------------------

export class MiddleOutStrategy implements CompressionStrategy {
  readonly name = 'middle-out' as const;
  readonly requiresLLM = true;
  /** @plan PLAN-20260211-HIGHDENSITY.P03 @requirement REQ-HD-001.3 */
  readonly trigger: StrategyTrigger = {
    mode: 'threshold',
    defaultThreshold: 0.85,
  };

  async compress(context: CompressionContext): Promise<CompressionResult> {
    const { history } = context;

    if (history.length === 0) {
      return this.noCompressionResult(history);
    }

    // Compute sandwich split
    let { toKeepTop, toCompress, toKeepBottom } = this.computeSplit(context);

    if (toCompress.length < MINIMUM_MIDDLE_MESSAGES) {
      return this.noCompressionResult(history);
    }

    // Preserve the last user prompt if it ended up in the middle section
    const {
      toCompress: adjustedCompress,
      toKeepBottom: adjustedBottom,
      lastUserPromptContext,
      largeLastPromptInjection,
    } = this.preserveLastUserPrompt(toKeepTop, toCompress, toKeepBottom);
    toCompress = adjustedCompress;
    toKeepBottom = adjustedBottom;

    if (toCompress.length < MINIMUM_MIDDLE_MESSAGES) {
      return this.noCompressionResult(history);
    }

    // Resolve the compression prompt
    const prompt = this.resolvePrompt(context);

    // Resolve the provider (compression profile may be undefined)
    const compressionProfile =
      context.runtimeContext.ephemerals.compressionProfile();
    const provider = context.resolveProvider(compressionProfile);

    // Build the LLM request — sanitize tool blocks to text so the compression
    // call doesn't trip Anthropic's strict tool_use/tool_result pairing
    // validation (orphaned blocks from interrupted loops would cause 400s).
    // @plan PLAN-20260211-HIGHDENSITY.P23
    // @requirement REQ-HD-011.3, REQ-HD-012.2
    const compressionRequest: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: prompt }],
      },
      ...sanitizeHistoryForCompression(toCompress),
      ...this.buildContextInjections(context),
      ...largeLastPromptInjection,
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: TRIGGER_INSTRUCTION }],
      },
    ];

    // Call the provider and aggregate the streamed response
    const { text: summary, usage: capturedUsage } = await this.callProvider(
      provider,
      compressionRequest,
    );

    if (!summary.trim()) {
      throw new CompressionExecutionError(
        'middle-out',
        'LLM returned empty summary during compression; this may be caused by rate limiting or a transient provider issue',
        { isTransient: true },
      );
    }

    // Assemble result
    const newHistory = this.assembleHistory(
      toKeepTop,
      summary,
      toKeepBottom,
      context.activeTodos,
      capturedUsage,
      lastUserPromptContext,
    );

    const metadata: CompressionResultMetadata = {
      originalMessageCount: history.length,
      compressedMessageCount: newHistory.length,
      strategyUsed: 'middle-out',
      llmCallMade: true,
      topPreserved: toKeepTop.length,
      bottomPreserved: toKeepBottom.length,
      middleCompressed: toCompress.length,
      ...(capturedUsage != null ? { usage: capturedUsage } : {}),
    };

    return { newHistory, metadata };
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

    let topSplitIndex = Math.ceil(history.length * topPreserveThreshold);
    let bottomSplitIndex = Math.floor(history.length * (1 - preserveThreshold));

    if (bottomSplitIndex - topSplitIndex < MINIMUM_MIDDLE_MESSAGES) {
      return { toKeepTop: [...history], toCompress: [], toKeepBottom: [] };
    }

    topSplitIndex = adjustForToolCallBoundary(history, topSplitIndex);
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

  private async callProvider(
    provider: IProvider,
    request: IContent[],
  ): Promise<{ text: string; usage?: UsageStats }> {
    try {
      const stream = provider.generateChatCompletion({
        contents: request,
        tools: undefined,
      });

      let summary = '';
      let lastBlockWasNonText = false;
      let capturedUsage: UsageStats | undefined;

      for await (const chunk of stream) {
        if (chunk.blocks) {
          const result = aggregateTextFromBlocks(
            chunk.blocks,
            summary,
            lastBlockWasNonText,
          );
          summary = result.text;
          lastBlockWasNonText = result.lastBlockWasNonText;
        }
        if (chunk.metadata?.usage != null) {
          capturedUsage = chunk.metadata.usage;
        }
      }

      return { text: summary, usage: capturedUsage };
    } catch (error) {
      throw new CompressionExecutionError(
        'middle-out',
        `LLM provider call failed: ${error instanceof Error ? error.message : String(error)}`,
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
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
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
      ...(usage != null ? { metadata: { usage } } : {}),
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
      },
      ...toKeepBottom,
    ];
  }

  private noCompressionResult(history: readonly IContent[]): CompressionResult {
    return {
      newHistory: [...history],
      metadata: {
        originalMessageCount: history.length,
        compressedMessageCount: history.length,
        strategyUsed: 'middle-out',
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
