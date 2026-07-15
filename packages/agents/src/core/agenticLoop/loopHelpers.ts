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

import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_AGENT_ID } from '@vybestack/llxprt-code-core/core/turn.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Partitions a flat `ContentBlock[]` into tool-call, tool-response, and other
 * blocks. Used to maintain proper history ordering: tool calls go to the
 * 'ai' speaker, tool responses + other blocks go to the 'tool' speaker.
 */
export function splitPartsByRole(parts: ContentBlock[]): {
  functionCalls: ContentBlock[];
  functionResponses: ContentBlock[];
  otherParts: ContentBlock[];
} {
  const functionCalls: ContentBlock[] = [];
  const functionResponses: ContentBlock[] = [];
  const otherParts: ContentBlock[] = [];

  for (const part of parts) {
    if (part.type === 'tool_call') {
      functionCalls.push(part);
    } else if (part.type === 'tool_response') {
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
 * Builds the flat list of tool-response blocks to feed back to the model.
 * Filters out tool-call blocks (already present in the assistant turn).
 */
export function buildToolResponses(
  completedTools: CompletedToolCall[],
): ContentBlock[] {
  return completedTools.flatMap((toolCall) =>
    toolCall.response.responseParts.filter(
      (block) => block.type !== 'tool_call',
    ),
  );
}

/**
 * Records completed or cancelled tool history via `agentClient.addHistory`,
 * splitting blocks by type so tool calls land under speaker 'ai' and tool
 * responses under speaker 'tool'. Used so the model sees a well-formed tool
 * response for every tool call it emitted.
 *
 * Awaits both writes so callers that continue or exit the loop immediately
 * afterwards can guarantee the tool history is durable before the next turn.
 */
async function recordCompletedToolHistory(
  tools: CompletedToolCall[],
  agentClient: AgentClientContract,
): Promise<void> {
  const allBlocks = tools.flatMap((tc) => tc.response.responseParts);
  const toolCallBlocks = allBlocks.filter(
    (b): b is ToolCallBlock => b.type === 'tool_call',
  );
  const nonToolCallBlocks = allBlocks.filter((b) => b.type !== 'tool_call');

  if (toolCallBlocks.length > 0) {
    await agentClient.addHistory(iContentFromBlocks(toolCallBlocks, 'ai'));
  }
  if (nonToolCallBlocks.length > 0) {
    await agentClient.addHistory(iContentFromBlocks(nonToolCallBlocks, 'tool'));
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
