/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @requirement REQ-LOOP-001
 *
 * Pure continuation helpers for the engine-owned agentic loop. These assemble
 * functionResponse parts from completed tool calls and partition them for
 * history recording (functionCalls → 'model' role, functionResponses + others
 * → 'user' role, to maintain well-formed Gemini turn history).
 */

import type { Content, Part } from '@google/genai';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { convertBlocksToParts } from '../MessageConverter.js';

function isFunctionCallPart(part: Part): boolean {
  return 'functionCall' in part;
}

/**
 * Partitions a flat `Part[]` into functionCalls, functionResponses, and other
 * parts. Used to maintain proper history ordering: functionCalls go to the
 * 'model' role, functionResponses + otherParts go to the 'user' role.
 */
export function splitPartsByRole(parts: Part[]): {
  functionCalls: Part[];
  functionResponses: Part[];
  otherParts: Part[];
} {
  const functionCalls: Part[] = [];
  const functionResponses: Part[] = [];
  const otherParts: Part[] = [];

  for (const part of parts) {
    if ('functionCall' in part) {
      functionCalls.push(part);
    } else if ('functionResponse' in part) {
      functionResponses.push(part);
    } else {
      otherParts.push(part);
    }
  }

  return { functionCalls, functionResponses, otherParts };
}

/**
 * Splits completed tool calls into primary (DEFAULT_AGENT_ID) and external
 * (subagent) lists, filtering to only those carrying valid responseParts.
 */
export function classifyCompletedTools(tools: CompletedToolCall[]): {
  primaryTools: CompletedToolCall[];
  externalTools: CompletedToolCall[];
} {
  const primary: CompletedToolCall[] = [];
  const external: CompletedToolCall[] = [];

  for (const toolCall of tools) {
    if (!Array.isArray(toolCall.response.responseParts)) {
      continue;
    }
    const agentId = toolCall.request.agentId ?? DEFAULT_AGENT_ID;
    if (agentId === DEFAULT_AGENT_ID) {
      primary.push(toolCall);
    } else {
      external.push(toolCall);
    }
  }

  return { primaryTools: primary, externalTools: external };
}

/**
 * Builds the flat list of functionResponse parts to feed back to the model.
 * Filters out functionCall parts (already present in the assistant turn).
 */
export function buildToolResponses(geminiTools: CompletedToolCall[]): Part[] {
  return geminiTools.flatMap((toolCall) =>
    convertBlocksToParts(toolCall.response.responseParts).filter(
      (part) => !isFunctionCallPart(part),
    ),
  );
}

export interface FilteredEagerToolResponses {
  readonly content: Content | null;
  readonly matchedCallIds: readonly string[];
}

export function filterEagerlyRecordedToolResponses(
  content: Content,
  eagerlyRecordedToolResponseCallIds: ReadonlySet<string>,
): FilteredEagerToolResponses {
  if (eagerlyRecordedToolResponseCallIds.size === 0) {
    return { content, matchedCallIds: [] };
  }

  const remainingParts: Part[] = [];
  const matchedCallIds: string[] = [];

  for (const part of content.parts ?? []) {
    const callId = part.functionResponse?.id;
    if (
      typeof callId === 'string' &&
      eagerlyRecordedToolResponseCallIds.has(callId)
    ) {
      matchedCallIds.push(callId);
      continue;
    }
    remainingParts.push(part);
  }

  if (matchedCallIds.length === 0) {
    return { content, matchedCallIds };
  }
  if (remainingParts.length === 0) {
    return { content: null, matchedCallIds };
  }

  return {
    content: {
      ...content,
      parts: remainingParts,
    },
    matchedCallIds,
  };
}

/**
 * Records completed tool history via `agentClient.addHistory`, splitting parts
 * by role so functionCalls land under 'model' and functionResponses under
 * 'user'. This eagerly persists tool outcomes before the next provider stream
 * starts, so a later stream failure/retry cannot orphan the prior tool_call and
 * trigger a synthetic null "interrupted or cancelled" placeholder.
 *
 * Awaits both writes so callers that continue or exit the loop immediately
 * afterwards can guarantee the tool history is durable before the next turn.
 */
async function recordCompletedToolHistory(
  tools: CompletedToolCall[],
  agentClient: AgentClientContract,
): Promise<void> {
  const allParts = tools.flatMap((tc) =>
    convertBlocksToParts(tc.response.responseParts),
  );
  const { functionCalls, functionResponses, otherParts } =
    splitPartsByRole(allParts);

  if (functionCalls.length > 0) {
    await agentClient.addHistory({ role: 'model', parts: functionCalls });
  }
  if (functionResponses.length > 0 || otherParts.length > 0) {
    await agentClient.addHistory({
      role: 'user',
      parts: [...functionResponses, ...otherParts],
    });
  }
}

/**
 * Records cancelled tool history eagerly using the same role-splitting logic as
 * successful completed tools. Kept as a dedicated helper to preserve the
 * existing call site semantics and readability at the cancelled-tools boundary.
 */
export async function recordCancelledToolHistory(
  tools: CompletedToolCall[],
  agentClient: AgentClientContract,
): Promise<void> {
  await recordCompletedToolHistory(tools, agentClient);
}
