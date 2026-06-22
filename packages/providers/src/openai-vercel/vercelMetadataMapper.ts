/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { LanguageModelUsage } from 'ai';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { processToolParameters } from '@vybestack/llxprt-code-tools/doubleEscapeUtils.js';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';
import type { StreamingState } from './vercelStreamTypes.js';
import type { CaptureBuffer } from './vercelReasoningCapture.js';

export interface UsageMetadata {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  cacheMissTokens?: number;
}

/**
 * Maps AI SDK usage + response headers to a normalized metadata object.
 */
export function mapUsageToMetadata(
  usage: LanguageModelUsage | undefined,
  headers?: Headers,
): UsageMetadata | undefined {
  if (!usage) return undefined;
  const promptTokens =
    usage.inputTokens ?? (usage as { promptTokens?: number }).promptTokens ?? 0;
  const completionTokens =
    usage.outputTokens ??
    (usage as { completionTokens?: number }).completionTokens ??
    0;
  const totalTokens =
    usage.totalTokens ??
    (typeof promptTokens === 'number' && typeof completionTokens === 'number'
      ? promptTokens + completionTokens
      : 0);

  const cacheMetricOrUndefined = (value: number | null | undefined) => {
    if (value == null || value === 0 || Number.isNaN(value)) {
      return undefined;
    }
    return value;
  };

  const cacheMetrics = extractCacheMetrics(usage, headers);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens: cacheMetricOrUndefined(cacheMetrics.cachedTokens),
    cacheCreationTokens: cacheMetricOrUndefined(
      cacheMetrics.cacheCreationTokens,
    ),
    cacheMissTokens: cacheMetricOrUndefined(cacheMetrics.cacheMissTokens),
  };
}

/**
 * Builds a metadata object from usage and finishReason if either is present.
 */
function buildMetadata(
  usageMeta: UsageMetadata | undefined,
  finishReason: string | undefined,
): Record<string, unknown> | undefined {
  return usageMeta || finishReason
    ? {
        ...(usageMeta ? { usage: usageMeta } : {}),
        ...(finishReason ? { finishReason } : {}),
      }
    : undefined;
}

/**
 * Builds ToolCallBlock array from collected tool calls.
 */
export function buildToolCallBlocks(
  collectedToolCalls: StreamingState['collectedToolCalls'],
): ToolCallBlock[] {
  return collectedToolCalls.map((call) => {
    let argsString = '{}';
    try {
      argsString =
        typeof call.input === 'string'
          ? call.input
          : JSON.stringify(call.input ?? {});
    } catch {
      argsString = '{}';
    }
    const processedParameters = processToolParameters(
      argsString,
      call.toolName,
    );
    return {
      type: 'tool_call',
      id: normalizeToHistoryToolId(normalizeToOpenAIToolId(call.toolCallId)),
      name: call.toolName,
      parameters: processedParameters,
    } as ToolCallBlock;
  });
}

/**
 * Emits tool calls and usage metadata at the end of a streaming response.
 */
export function* emitStreamToolCallsAndMetadata(
  state: StreamingState,
  captureBuffer: CaptureBuffer,
): IterableIterator<IContent> {
  if (state.collectedToolCalls.length > 0) {
    const blocks = buildToolCallBlocks(state.collectedToolCalls);
    const usageMeta = mapUsageToMetadata(
      state.totalUsage,
      captureBuffer.headers,
    );
    const metadata = buildMetadata(usageMeta, state.finishReason);
    yield {
      speaker: 'ai',
      blocks,
      ...(metadata ? { metadata } : {}),
    } as IContent;
  } else {
    const usageMeta = mapUsageToMetadata(
      state.totalUsage,
      captureBuffer.headers,
    );
    const metadata = buildMetadata(usageMeta, state.finishReason);
    if (metadata) {
      yield { speaker: 'ai', blocks: [], metadata } as IContent;
    }
  }
}
