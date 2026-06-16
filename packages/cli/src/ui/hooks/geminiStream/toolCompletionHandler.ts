/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Display-side helpers for completed tool calls. Continuation (assembling
 * functionResponse parts and re-submitting the turn) is owned by the
 * engine AgenticLoop in @vybestack/llxprt-code-agents; this module only
 * partitions completed tools and triggers memory refresh for the CLI display.
 */

import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { Part } from '@google/genai';
import { classifyCompletedTools as classifyCompletedToolsEngine } from '@vybestack/llxprt-code-agents';
import type { TrackedToolCall } from '../useReactToolScheduler.js';

type ToolCallWithRuntimeResponseParts = CompletedToolCall & {
  response: { responseParts: Part[] };
};

function isToolCallWithResponseParts(
  toolCall: TrackedToolCall,
): toolCall is ToolCallWithRuntimeResponseParts {
  if (
    toolCall.status !== 'success' &&
    toolCall.status !== 'error' &&
    toolCall.status !== 'cancelled'
  ) {
    return false;
  }

  const response = (toolCall as { response?: { responseParts?: unknown } })
    .response;
  return Array.isArray(response?.responseParts);
}

/**
 * Narrows TrackedToolCall[] (which may include non-terminal states like
 * 'executing') to terminal-state tools with responseParts, suitable for the
 * engine helpers that accept CompletedToolCall[].
 */
function filterToCompletedToolsWithResponses(
  tools: TrackedToolCall[],
): ToolCallWithRuntimeResponseParts[] {
  return tools.filter(isToolCallWithResponseParts);
}

/**
 * Splits completed tool calls into primary (DEFAULT_AGENT_ID) and external
 * (subagent) lists, filtering to only those with valid responseParts.
 *
 * The CLI-side filter narrows TrackedToolCall[] (which includes non-terminal
 * states like 'executing') to CompletedToolCall[] before delegating the
 * partitioning to the engine classifyCompletedTools.
 */
export function classifyCompletedTools(tools: TrackedToolCall[]): {
  primaryTools: CompletedToolCall[];
  externalTools: CompletedToolCall[];
} {
  return classifyCompletedToolsEngine(
    filterToCompletedToolsWithResponses(tools),
  );
}

/**
 * Detects new successful save_memory calls and triggers a refresh if found.
 * Marks newly processed tools in the processedMemoryToolsRef set.
 */
export function processMemoryToolResults(
  primaryTools: CompletedToolCall[],
  processedMemoryToolsRef: React.MutableRefObject<Set<string>>,
  performMemoryRefresh: () => Promise<void>,
): void {
  const newSuccessfulMemorySaves = primaryTools.filter(
    (t) =>
      t.request.name === 'save_memory' &&
      t.status === 'success' &&
      !processedMemoryToolsRef.current.has(t.request.callId),
  );

  if (newSuccessfulMemorySaves.length > 0) {
    void performMemoryRefresh();
    newSuccessfulMemorySaves.forEach((t) =>
      processedMemoryToolsRef.current.add(t.request.callId),
    );
  }
}
