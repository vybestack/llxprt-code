/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  normalizeToolName,
  canonicalizeToolName,
} from '@vybestack/llxprt-code-tools';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  ContentBlock,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parseThought,
  type ThoughtSummary,
} from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import { buildCitationEvent } from './turnCitations.js';
import { safeJsonStringify } from './turnJsonUtils.js';
import { responseToolIdentity } from './responseArrival.js';

function rawToolName(call: ToolCallBlock): string {
  const value: unknown = call.name;
  let raw = '';
  if (typeof value === 'string') raw = value;
  else if (value != null) raw = String(value);
  return (raw.trim() ? normalizeToolName(raw) : null) ?? raw;
}

function parameters(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function toolRequestFromBlock(
  call: ToolCallBlock,
  functionCallIndex: number,
  promptId: string,
  agentId: string,
): ToolCallRequestInfo {
  const name = rawToolName(call);
  const digest =
    call.id === ''
      ? createHash('sha256')
          .update(
            safeJsonStringify({
              promptId,
              agentId,
              functionCallIndex,
              name: call.name,
              args: call.parameters ?? {},
            }),
          )
          .digest('hex')
          .slice(0, 16)
      : undefined;
  return {
    callId: call.id !== '' ? call.id : `${name}-${functionCallIndex}-${digest}`,
    name,
    args: parameters(call.parameters) ? call.parameters : {},
    isClientInitiated: false,
    prompt_id: promptId,
    agentId,
    journalIdentity: responseToolIdentity(call),
  };
}

export function filterBlocksByAllowedTools(
  blocks: ContentBlock[],
  allowedToolNames: string[] | undefined,
): ContentBlock[] {
  if (allowedToolNames === undefined) return [...blocks];
  const allowed = new Set(allowedToolNames.map(canonicalizeToolName));
  return blocks.filter((block) => {
    if (block.type === 'tool_call')
      return allowed.has(canonicalizeToolName(block.name));
    if (block.type === 'tool_response')
      return allowed.has(canonicalizeToolName(block.toolName));
    return true;
  });
}

export function* emitThoughtContent(
  blocks: ContentBlock[],
  traceId: string | undefined,
): Generator<ServerAgentStreamEvent> {
  for (const block of blocks) {
    if (block.type === 'thinking' && block.isHidden !== true) {
      const thought: ThoughtSummary = {
        ...parseThought(block.thought),
        ...(block.streamId !== undefined ? { streamId: block.streamId } : {}),
        ...(block.streamStatus !== undefined
          ? { streamStatus: block.streamStatus }
          : {}),
      };
      yield { type: AgentEventType.Thought, value: thought, traceId };
    }
  }
}

export function* emitTextContent(
  blocks: ContentBlock[],
  traceId: string | undefined,
  showCitations: () => boolean,
): Generator<ServerAgentStreamEvent, string> {
  const text = blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('');
  if (text !== '') {
    yield { type: AgentEventType.Content, value: text, traceId };
    if (text.trim() !== '') {
      const citation = buildCitationEvent(
        showCitations(),
        'Response may contain information from external sources. Please verify important details independently.',
      );
      if (citation) yield citation;
    }
  }
  return text;
}
