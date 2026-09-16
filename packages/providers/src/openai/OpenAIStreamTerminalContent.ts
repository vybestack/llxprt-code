/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IContent,
  type ThinkingBlock,
  type ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { firstTruthyString } from '../utils/falsyFallback.js';
import { normalizeToHistoryToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { processToolParameters } from '@vybestack/llxprt-code-tools/doubleEscapeUtils.js';
import {
  extractKimiToolCallsFromText,
  sanitizeToolArgumentsString,
} from './OpenAIResponseParser.js';
import { mapFinishReason } from './finishReasonMapping.js';
import {
  type StreamingState,
  buildUsageMetadata,
  applyTerminalMetadata,
} from './OpenAIStreamProcessorState.js';
import { type StreamProcessorDeps } from './OpenAIStreamProcessor.js';

/**
 * Build pipeline tool-call blocks from the cached pipeline result.
 */
function buildPipelineToolCallBlocks(
  state: StreamingState,
  deps: StreamProcessorDeps,
): ToolCallBlock[] {
  const result = state.cachedPipelineResult;
  if (!result) return [];
  const blocks: ToolCallBlock[] = [];
  if (result.normalized.length > 0 || result.failed.length > 0) {
    for (const normalizedCall of result.normalized) {
      const sanitizedArgs = sanitizeToolArgumentsString(
        normalizedCall.originalArgs ?? normalizedCall.args,
        deps.logger,
      );

      const processedParameters = processToolParameters(
        sanitizedArgs,
        normalizedCall.name,
      );

      blocks.push({
        type: 'tool_call',
        id: normalizeToHistoryToolId(
          firstTruthyString(normalizedCall.id, `call_${normalizedCall.index}`),
        ),
        name: normalizedCall.name,
        parameters: processedParameters,
      });
    }

    for (const failed of result.failed) {
      deps.logger.warn(
        `Tool call validation failed for index ${failed.index}: ${failed.validationErrors.join(', ')}`,
      );
    }
  }
  return blocks;
}

/**
 * Emit combined terminal content with reasoning blocks and pipeline tool calls.
 */
export function* emitCombinedTerminalContent(
  state: StreamingState,
  model: string,
  deps: StreamProcessorDeps,
): Generator<IContent, void, unknown> {
  const { cleanedText: cleanedReasoning, toolCalls: reasoningToolCalls } =
    state.accumulatedReasoningContent.length > 0
      ? extractKimiToolCallsFromText(
          state.accumulatedReasoningContent,
          deps.logger,
        )
      : { cleanedText: '', toolCalls: [] as ToolCallBlock[] };

  const pipelineToolCallBlocks = buildPipelineToolCallBlocks(state, deps);

  const combinedBlocks: Array<ThinkingBlock | ToolCallBlock> = [];

  if (cleanedReasoning.length > 0) {
    combinedBlocks.push({
      type: 'thinking',
      thought: cleanedReasoning,
      sourceField: state.reasoningSourceField ?? 'reasoning_content',
      isHidden: false,
    } as ThinkingBlock);
  }

  combinedBlocks.push(...reasoningToolCalls, ...pipelineToolCallBlocks);

  if (combinedBlocks.length > 0) {
    const combinedContent: IContent = {
      speaker: 'ai',
      blocks: combinedBlocks,
    };

    const finishInfo = state.lastFinishReason
      ? mapFinishReason(state.lastFinishReason)
      : undefined;
    deps.logger.debug(
      () => `[stream:terminal] building combined terminal content`,
      {
        model,
        combinedBlockCount: combinedBlocks.length,
        cleanedReasoningLength: cleanedReasoning.length,
        reasoningToolCallCount: reasoningToolCalls.length,
        pipelineToolCallCount: pipelineToolCallBlocks.length,
        rawFinishReason: state.lastFinishReason,
        ...finishInfo,
        hasStreamingUsage: Boolean(state.streamingUsage),
      },
    );

    if (state.streamingUsage !== null) {
      combinedContent.metadata = buildUsageMetadata(
        state.streamingUsage,
        finishInfo,
      );
    } else if (finishInfo) {
      combinedContent.metadata = finishInfo;
    }

    applyTerminalMetadata(combinedContent, state, finishInfo);

    deps.logger.debug(
      () => `[stream:terminal] emitting combined terminal content`,
      {
        model,
        blockCount: combinedContent.blocks.length,
        rawStopReason: combinedContent.metadata?.rawStopReason,
        finishReason: combinedContent.metadata?.finishReason,
        hasUsage: Boolean(combinedContent.metadata?.usage),
        hasEmittedTerminalMetadata: state.hasEmittedTerminalMetadata,
      },
    );
    yield combinedContent;
  } else {
    deps.logger.debug(
      () => `[stream:terminal] skipped combined terminal content emission`,
      {
        model,
        cleanedReasoningLength: cleanedReasoning.length,
        reasoningToolCallCount: reasoningToolCalls.length,
        pipelineToolCallCount: pipelineToolCallBlocks.length,
        rawFinishReason: state.lastFinishReason,
        hasStreamingUsage: Boolean(state.streamingUsage),
      },
    );
  }
}
