/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boundary wrap: converts the internal synthetic GenerateContentResponse
 * (produced by MessageConverter/StreamProcessor from provider IContent)
 * into the neutral ModelStreamChunk that the StreamEvent.CHUNK type now
 * carries. The agents internal pipeline remains Google-shaped until #2349;
 * this wrap lives at the TurnProcessor yield boundary so core's StreamEvent
 * type has zero @google/genai imports.
 *
 * @issue #2348
 */

import type { GenerateContentResponse } from '@google/genai';
import type {
  ModelStreamChunk,
  HookRestrictions,
  CanonicalFinishReason,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { mapGeminiFinishReason } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  getHookRestrictedAllowedTools,
  hasFilteredHookRestrictedToolCalls,
} from './hookToolRestrictions.js';
import { getProviderStopReason } from './providerStopReason.js';
import {
  classifyMixedParts,
  convertBlocksToParts,
} from './MessageConverter.js';
import type { UsageMetadataWithCache } from './googlePartHelpers.js';

/**
 * Converts usage metadata from Google shape to neutral UsageStats.
 */
export function usageMetadataToUsageStats(
  usage: UsageMetadataWithCache | undefined,
): UsageStats | undefined {
  if (usage === undefined) {
    return undefined;
  }
  const stats: UsageStats = {
    promptTokens: usage.promptTokenCount ?? 0,
    completionTokens: usage.candidatesTokenCount ?? 0,
    totalTokens: usage.totalTokenCount ?? 0,
  };
  if (usage.cachedContentTokenCount !== undefined) {
    stats.cachedTokens = usage.cachedContentTokenCount;
  }
  if (usage.thoughtsTokenCount !== undefined) {
    stats.reasoningTokens = usage.thoughtsTokenCount;
  }
  if (usage.toolUsePromptTokenCount !== undefined) {
    stats.toolTokens = usage.toolUsePromptTokenCount;
  }
  if (usage.cache_read_input_tokens !== undefined) {
    stats.cache_read_input_tokens = usage.cache_read_input_tokens;
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    stats.cache_creation_input_tokens = usage.cache_creation_input_tokens;
  }
  return stats;
}

/**
 * Reconstructs an IContent from a GenerateContentResponse's first candidate.
 * Uses ContentConverters.toIContent so the block types (text, tool_call,
 * thinking, etc.) are derived correctly.
 */
function responseToIContent(resp: GenerateContentResponse): IContent {
  const candidate = resp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const role = candidate?.content?.role ?? 'model';
  const speaker: IContent['speaker'] = role === 'user' ? 'human' : 'ai';

  const { blocks, hasToolContent } = classifyMixedParts(parts);

  const finalSpeaker: IContent['speaker'] =
    role === 'user' && hasToolContent ? 'tool' : speaker;

  const content: IContent = { speaker: finalSpeaker, blocks };

  const meta = content.metadata ?? {};
  if (resp.responseId) {
    meta.id = resp.responseId;
  }
  content.metadata = meta;

  return content;
}

/**
 * Wraps a GenerateContentResponse into a neutral ModelStreamChunk at the
 * StreamEvent boundary. Reads hook restrictions from the WeakMap side
 * channel and carries them explicitly on the chunk so object identity
 * loss does not break hook tool filtering.
 */
export function responseToModelStreamChunk(
  resp: GenerateContentResponse,
): ModelStreamChunk {
  const content = responseToIContent(resp);

  const candidate = resp.candidates?.[0];
  const rawFinishReason = candidate?.finishReason;
  const providerStopReason = getProviderStopReason(candidate);

  let finishReason: CanonicalFinishReason | undefined;
  let rawStopReason: string | undefined;

  if (rawFinishReason !== undefined) {
    const mapped = mapGeminiFinishReason(String(rawFinishReason));
    finishReason = mapped.finishReason;
    rawStopReason = providerStopReason ?? mapped.rawStopReason;
  } else if (providerStopReason !== undefined) {
    rawStopReason = providerStopReason;
  }

  const usage = usageMetadataToUsageStats(
    resp.usageMetadata as UsageMetadataWithCache | undefined,
  );

  const allowedToolNames = getHookRestrictedAllowedTools(resp);
  const filteredRestrictedCalls = hasFilteredHookRestrictedToolCalls(resp);
  const hookRestrictions: HookRestrictions | undefined =
    allowedToolNames !== undefined || filteredRestrictedCalls
      ? {
          ...(allowedToolNames !== undefined ? { allowedToolNames } : {}),
          ...(filteredRestrictedCalls
            ? { hadFilteredRestrictedCalls: true }
            : {}),
        }
      : undefined;

  const chunk: ModelStreamChunk = { content };

  if (finishReason !== undefined) {
    chunk.finishReason = finishReason;
  }
  if (rawStopReason !== undefined) {
    chunk.rawStopReason = rawStopReason;
  }
  if (usage !== undefined) {
    chunk.usage = usage;
  }
  if (resp.responseId) {
    chunk.responseId = resp.responseId;
  }
  if (hookRestrictions !== undefined) {
    chunk.hookRestrictions = hookRestrictions;
  }

  return chunk;
}

/**
 * Converts a ModelStreamChunk's content blocks back to the legacy Google
 * Part[] shape for consumers that still operate on Part[] (the agents Turn
 * class until #2349). Uses MessageConverter.convertBlocksToParts for fidelity.
 */
export function chunkToParts(
  chunk: ModelStreamChunk,
): ReturnType<typeof convertBlocksToParts> {
  return convertBlocksToParts(chunk.content.blocks);
}
