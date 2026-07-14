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

/**
 * Neutral builder for ModelStreamChunk test fixtures. Takes NEUTRAL
 * parameters (no candidates/parts shape) to avoid Google-shaped fixture
 * data.
 */
export function mockChunk(opts: {
  text?: string;
  thought?: string;
  thoughtSignature?: string;
  toolCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  toolResponses?: Array<{
    id?: string;
    name?: string;
    response?: unknown;
  }>;
  finishReason?: string;
  /** Overrides rawStopReason; when omitted, rawStopReason = finishReason string. */
  rawStopReason?: string;
  usage?: Partial<UsageStats>;
  responseId?: string;
  hookRestrictions?: { allowedToolNames?: string[] };
}): ModelStreamChunk {
  const chunk: ModelStreamChunk = {
    content: { speaker: 'ai', blocks: buildMockBlocks(opts) },
  };

  if (opts.finishReason !== undefined) {
    chunk.finishReason = mapMockFinishReason(opts.finishReason);
    chunk.rawStopReason = opts.rawStopReason ?? opts.finishReason;
  }
  if (opts.usage !== undefined) {
    chunk.usage = {
      promptTokens: opts.usage.promptTokens ?? 0,
      completionTokens: opts.usage.completionTokens ?? 0,
      totalTokens: opts.usage.totalTokens ?? 0,
      ...(opts.usage.cachedTokens !== undefined
        ? { cachedTokens: opts.usage.cachedTokens }
        : {}),
      ...(opts.usage.reasoningTokens !== undefined
        ? { reasoningTokens: opts.usage.reasoningTokens }
        : {}),
    };
  }
  if (opts.responseId !== undefined) {
    chunk.responseId = opts.responseId;
  }
  if (opts.hookRestrictions !== undefined) {
    chunk.hookRestrictions = {
      allowedToolNames: [...(opts.hookRestrictions.allowedToolNames ?? [])],
    };
  }
  return chunk;
}

function buildMockBlocks(opts: {
  thought?: string;
  thoughtSignature?: string;
  text?: string;
  toolCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  toolResponses?: Array<{
    id?: string;
    name?: string;
    response?: unknown;
  }>;
}): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (opts.thought !== undefined) {
    blocks.push({
      type: 'thinking',
      thought: opts.thought,
      isHidden: true,
      sourceField: 'thinking',
      ...(opts.thoughtSignature !== undefined
        ? { signature: opts.thoughtSignature }
        : {}),
    });
  }
  if (opts.text !== undefined) {
    blocks.push({ type: 'text', text: opts.text });
  }
  for (const tc of opts.toolCalls ?? []) {
    blocks.push({
      type: 'tool_call',
      id: tc.id ?? '',
      name: tc.name ?? '',
      parameters: tc.args ?? {},
    });
  }
  for (const tr of opts.toolResponses ?? []) {
    blocks.push({
      type: 'tool_response',
      callId: tr.id ?? '',
      toolName: tr.name ?? '',
      result: tr.response ?? {},
    });
  }
  return blocks;
}
