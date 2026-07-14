/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Neutral hook tool-restriction API.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 * @pseudocode lines 20-43 (hooktoolrestrictions-neutral.md)
 *
 * Restriction metadata rides explicit HookRestrictions on ModelStreamChunk;
 * filtering operates on ContentBlock[]/ToolCallBlock. No WeakMaps, no
 * Symbols, no GenerateContentResponse identity keying.
 */

import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ModelStreamChunk,
  HookRestrictions,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { getToolCallBlocks } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { canonicalizeToolName } from './toolGovernance.js';

/**
 * Apply hook restrictions to a ModelStreamChunk, filtering tool-call blocks
 * by the allowed-tools set and stamping HookRestrictions metadata.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 * @pseudocode lines 23-30
 */
export function applyHookRestrictionsToChunk(
  chunk: ModelStreamChunk,
  allowedTools: readonly string[] | undefined,
): ModelStreamChunk {
  if (allowedTools === undefined) {
    return chunk;
  }
  const toolCallBlocks = getToolCallBlocks(chunk.content.blocks);
  const allowedSet = new Set(allowedTools.map(canonicalizeToolName));
  const removed = toolCallBlocks.filter(
    (b) => !allowedSet.has(canonicalizeToolName(b.name)),
  );
  const newBlocks = filterHookRestrictedBlocks(
    chunk.content.blocks,
    allowedTools,
  );
  const hookRestrictions: HookRestrictions = {
    allowedToolNames: [...allowedTools],
    hadFilteredRestrictedCalls: removed.length > 0,
  };
  return {
    ...chunk,
    content: { ...chunk.content, blocks: newBlocks },
    hookRestrictions,
  };
}

/**
 * Filters ContentBlocks by hook-restricted allowed tool names.
 * Tool-call and tool-response blocks are kept only if their tool name is in
 * the allowed set; other block types always pass.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P07/P11
 * @requirement:REQ-003.2
 * @pseudocode lines 31-34
 */
export function filterHookRestrictedBlocks(
  blocks: readonly ContentBlock[],
  allowedTools: readonly string[] | undefined,
): ContentBlock[] {
  if (allowedTools === undefined) {
    return [...blocks];
  }
  const allowed = new Set(allowedTools.map(canonicalizeToolName));
  return blocks.filter((block) => {
    if (block.type === 'tool_call') {
      return allowed.has(canonicalizeToolName(block.name));
    }
    if (block.type === 'tool_response') {
      return allowed.has(canonicalizeToolName(block.toolName));
    }
    return true;
  });
}

/**
 * Read allowed tool names from a ModelStreamChunk's hookRestrictions.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 * @pseudocode lines 35-36
 */
export function getHookRestrictedAllowedTools(
  chunk: ModelStreamChunk,
): string[] | undefined {
  return chunk.hookRestrictions?.allowedToolNames;
}

/**
 * Check whether a chunk had any tool calls filtered by hook restrictions.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 * @pseudocode lines 37-38
 */
export function hasFilteredHookRestrictedToolCalls(
  chunk: ModelStreamChunk,
): boolean {
  return chunk.hookRestrictions?.hadFilteredRestrictedCalls === true;
}

/**
 * Filter AFC (automatic function calling) history IContent[] by hook
 * restrictions, operating on ContentBlock[] per entry.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 * @pseudocode lines 40-43
 */
export function filterAfcByHookRestrictions(
  afc: readonly IContent[],
  allowedTools: readonly string[] | undefined,
): IContent[] {
  if (allowedTools === undefined) {
    return [...afc];
  }
  return afc
    .map((c) => ({
      ...c,
      blocks: filterHookRestrictedBlocks(c.blocks, allowedTools),
    }))
    .filter((c) => c.blocks.length > 0);
}

/**
 * Check whether a tool call name is restricted by the allowed-tools set.
 * Neutral version — operates on tool name strings, not FunctionCall objects.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 */
export function isToolNameRestricted(
  toolName: string,
  allowedTools: readonly string[] | undefined,
): boolean {
  if (allowedTools === undefined) {
    return false;
  }
  if (toolName.trim() === '') {
    return true;
  }
  const allowed = new Set(allowedTools.map(canonicalizeToolName));
  return !allowed.has(canonicalizeToolName(toolName));
}
