/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

const MINIMUM_COMPRESS_MESSAGES = 4;

const TRIGGER_INSTRUCTION =
  'First, reason in your scratchpad. Then, generate the <state_snapshot>.';

// ---------------------------------------------------------------------------
// OneShotStrategy
// ---------------------------------------------------------------------------

export class OneShotStrategy implements CompressionStrategy {
  readonly name = 'one-shot' as const;
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

    // Compute the split: everything above the preserved tail gets compressed
    const { toCompress, toKeep } = this.computeSplit(context);

    if (toCompress.length < MINIMUM_COMPRESS_MESSAGES) {
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
        'one-shot',
        'LLM returned empty summary during compression',
      );
    }

    // Assemble result: summary + continuation directive + preserved tail
    const newHistory: IContent[] = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: summary }],
      },
      {
        speaker: 'ai' as const,
        blocks: [
          {
            type: 'text' as const,
            text: buildContinuationDirective(context.activeTodos),
          },
        ],
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
    };

    return { newHistory, metadata };
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
        'one-shot',
        `LLM provider call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private noCompressionResult(history: readonly IContent[]): CompressionResult {
    return {
      newHistory: [...history],
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
