/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for turn test files. Extracted from the original monolithic
 * turn.test.ts so no file-level max-lines disable is needed.
 */

import type { ServerAgentStreamEvent, ServerFinishedEvent } from './turn.js';
import { AgentEventType } from './turn.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  ContentBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Mock } from 'vitest';

export type MockedChatInstance = {
  sendMessageStream: Mock;
  getHistory: Mock;
  getConfig: () =>
    | { getEphemeralSetting: (key: string) => unknown }
    | undefined;
};

export function findFinishedEvent(
  events: ServerAgentStreamEvent[],
): ServerFinishedEvent | undefined {
  return events.find(
    (event): event is ServerFinishedEvent =>
      event.type === AgentEventType.Finished,
  );
}

/**
 * Converts a legacy mock GenerateContentResponse shape (with candidates/parts)
 * into a neutral ModelStreamChunk for test stream events.
 *
 * This lets turn test files keep their existing part-based mock data while
 * the StreamEvent.CHUNK boundary now carries ModelStreamChunk.
 */
export function mockResponseToChunk(response: {
  candidates?: Array<{
    content?: { parts?: Array<Record<string, unknown>> };
    finishReason?: string;
    finishMessage?: string;
    providerStopReason?: string;
  }>;
  usageMetadata?: Record<string, number | undefined>;
  responseId?: string;
}): ModelStreamChunk {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const blocks = partsToBlocks(parts);
  const finishReason = candidate?.finishReason;
  const providerStopReason = candidate?.providerStopReason;

  const chunk: ModelStreamChunk = {
    content: { speaker: 'ai', blocks },
  };

  if (finishReason !== undefined) {
    chunk.finishReason = mapMockFinishReason(finishReason);
    // providerStopReason wins over the Gemini finishReason string when present,
    // matching the production boundary (streamChunkWrapper.responseToModelStreamChunk).
    chunk.rawStopReason = providerStopReason ?? finishReason;
  } else if (providerStopReason !== undefined) {
    chunk.rawStopReason = providerStopReason;
  }

  const u = response.usageMetadata;
  if (u) {
    const usage: UsageStats = {
      promptTokens: u.promptTokenCount ?? 0,
      completionTokens: u.candidatesTokenCount ?? 0,
      totalTokens: u.totalTokenCount ?? 0,
    };
    if (u.cachedContentTokenCount !== undefined) {
      usage.cachedTokens = u.cachedContentTokenCount;
    }
    if (u.thoughtsTokenCount !== undefined) {
      usage.reasoningTokens = u.thoughtsTokenCount;
    }
    chunk.usage = usage;
  }

  if (response.responseId !== undefined) {
    chunk.responseId = response.responseId;
  }

  return chunk;
}

function partsToBlocks(parts: Array<Record<string, unknown>>): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    const block = partToBlock(part);
    if (block !== null) {
      blocks.push(block);
    }
  }
  return blocks;
}

function partToBlock(part: Record<string, unknown>): ContentBlock | null {
  const thought = part['thought'];
  if (thought === true || thought === 'true') {
    const text = typeof part['text'] === 'string' ? part['text'] : '';
    return {
      type: 'thinking',
      thought: text,
      isHidden: true,
      sourceField: 'thought',
    };
  }
  if (typeof part['text'] === 'string') {
    return { type: 'text', text: part['text'] };
  }
  const fc = part['functionCall'];
  if (isRecord(fc)) {
    return {
      type: 'tool_call',
      id: (fc['id'] ?? '') as string,
      name: (fc['name'] ?? '') as string,
      parameters: fc['args'] ?? {},
    };
  }
  const fr = part['functionResponse'];
  if (isRecord(fr)) {
    return {
      type: 'tool_response',
      callId: (fr['id'] ?? '') as string,
      toolName: (fr['name'] ?? '') as string,
      result: fr['response'] ?? {},
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mapMockFinishReason(raw: string): ModelStreamChunk['finishReason'] {
  const map: Record<string, ModelStreamChunk['finishReason']> = {
    STOP: 'stop',
    MAX_TOKENS: 'max_tokens',
    SAFETY: 'safety',
    RECITATION: 'safety',
    LANGUAGE: 'other',
    BLOCKLIST: 'safety',
    PROHIBITED_CONTENT: 'safety',
    SPII: 'safety',
    MALFORMED_FUNCTION_CALL: 'error',
    OTHER: 'other',
    stop: 'stop',
    length: 'max_tokens',
    max_tokens: 'max_tokens',
    tool_calls: 'tool_calls',
    content_filter: 'safety',
    refusal: 'refusal',
    end_turn: 'stop',
    tool_use: 'tool_calls',
  };
  return map[raw] ?? 'other';
}
