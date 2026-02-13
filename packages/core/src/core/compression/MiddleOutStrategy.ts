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
import type { IContent } from '../../services/history/IContent.js';
import type { IProvider } from '../../providers/IProvider.js';
import type {
  CompressionContext,
  CompressionResult,
  CompressionResultMetadata,
  CompressionStrategy,
  StrategyTrigger,
} from './types.js';
import { CompressionExecutionError, PromptResolutionError } from './types.js';
import {
  adjustForToolCallBoundary,
  aggregateTextFromBlocks,
  buildContinuationDirective,
} from './utils.js';
import { getCompressionPrompt } from '../prompts.js';

const MINIMUM_MIDDLE_MESSAGES = 4;

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
    const { toKeepTop, toCompress, toKeepBottom } = this.computeSplit(context);

    if (toCompress.length < MINIMUM_MIDDLE_MESSAGES) {
      return this.noCompressionResult(history);
    }

    // Resolve the compression prompt
    const prompt = this.resolvePrompt(context);

    // Resolve the provider (compression profile may be undefined)
    const compressionProfile =
      context.runtimeContext.ephemerals.compressionProfile();
    const provider = context.resolveProvider(compressionProfile);

    // Build the LLM request
    // @plan PLAN-20260211-HIGHDENSITY.P23
    // @requirement REQ-HD-011.3, REQ-HD-012.2
    const compressionRequest: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: prompt }],
      },
      ...toCompress,
      ...this.buildContextInjections(context),
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: TRIGGER_INSTRUCTION }],
      },
    ];

    // Call the provider and aggregate the streamed response
    const summary = await this.callProvider(provider, compressionRequest);

    if (!summary.trim()) {
      throw new CompressionExecutionError(
        'middle-out',
        'LLM returned empty summary during compression',
      );
    }

    // Assemble result
    const newHistory = this.assembleHistory(
      toKeepTop,
      summary,
      toKeepBottom,
      context.activeTodos,
    );

    const metadata: CompressionResultMetadata = {
      originalMessageCount: history.length,
      compressedMessageCount: newHistory.length,
      strategyUsed: 'middle-out',
      llmCallMade: true,
      topPreserved: toKeepTop.length,
      bottomPreserved: toKeepBottom.length,
      middleCompressed: toCompress.length,
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
  ): Promise<string> {
    try {
      const stream = provider.generateChatCompletion({
        contents: request,
        tools: undefined,
      });

      let summary = '';
      let lastBlockWasNonText = false;

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
      }

      return summary;
    } catch (error) {
      throw new CompressionExecutionError(
        'middle-out',
        `LLM provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private assembleHistory(
    toKeepTop: IContent[],
    summary: string,
    toKeepBottom: IContent[],
    activeTodos?: string,
  ): IContent[] {
    return [
      ...toKeepTop,
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: summary }],
      },
      {
        speaker: 'ai' as const,
        blocks: [
          {
            type: 'text' as const,
            text: buildContinuationDirective(activeTodos),
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
