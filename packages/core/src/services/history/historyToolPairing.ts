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

import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import type { DebugLogger } from '../../debug/index.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryToolNormalization } from './historyToolNormalization.js';
import { ToolPairingIndex } from './tool-pairing-index.js';

export interface ToolPairingStreamOptions {
  readonly root?: string;
  readonly ownership?: RowOwnership;
}

/**
 * Helper predicate: checks if content has valid blocks array with at least one element.
 * Used for defensive runtime guards that tolerate malformed persisted/runtime history.
 * Preserves old !content.blocks optional-chain protections.
 * Uses runtime widening to handle potentially malformed persisted data while avoiding
 * type comparison warnings for non-nullable static types.
 */
export function hasValidBlocks(content: IContent): boolean {
  // Widen to unknown for runtime check to handle malformed persisted history
  // where blocks may not be an array despite static typing
  const blocks: unknown = content.blocks;
  return Array.isArray(blocks) && blocks.length > 0;
}

/** Collect the set of call IDs that have a tool_response block. */
export function collectRespondedCallIds(
  contents: readonly IContent[],
): Set<string> {
  return HistoryToolNormalization.collectRespondedCallIds(contents);
}

/**
 * Return tool calls in an AI content entry that lack a matching tool_response,
 * based on the provided set of responded call IDs.
 */
export function getMissingToolCalls(
  content: IContent,
  respondedCallIds: ReadonlySet<string>,
): ToolCallBlock[] {
  if (content.speaker !== 'ai' || !hasValidBlocks(content)) {
    return [];
  }

  return content.blocks.filter(
    (block): block is ToolCallBlock =>
      block.type === 'tool_call' && !respondedCallIds.has(block.id),
  );
}

/**
 * Build a synthetic tool-speaker message for orphaned tool calls so the
 * transcript remains provider-compliant.
 */
export function createSyntheticToolMessage(
  missing: readonly ToolCallBlock[],
): IContent {
  return {
    speaker: 'tool',
    blocks: missing.map(
      (tc): ToolResponseBlock => ({
        type: 'tool_response',
        callId: tc.id,
        toolName: tc.name === '' ? 'unknown_tool' : tc.name,
        result: null,
        error: 'Tool call interrupted or cancelled',
        isComplete: true,
      }),
    ),
    metadata: {
      synthetic: true,
      reason: 'orphaned_tool_call',
    },
  };
}

function indexToolBlocks(index: ToolPairingIndex, row: IContent): void {
  if (!hasValidBlocks(row)) return;
  for (const block of row.blocks) {
    if (block.type === 'tool_response') index.respond(block.callId);
    else if (block.type === 'tool_call') index.add(block);
  }
}

/** Scan the captured history before yielding: even its last row can answer a call. */
export async function* findUnmatchedToolCalls(
  logger: DebugLogger,
  history: AsyncIterable<IContent>,
  options: ToolPairingStreamOptions = {},
): AsyncGenerator<ToolCallBlock, void, unknown> {
  const index = new ToolPairingIndex(options.root);
  let unmatchedCount = 0;
  try {
    for await (const row of history) indexToolBlocks(index, row);
    for (const block of index.unmatched()) {
      options.ownership?.retain(block);
      try {
        unmatchedCount += 1;
        yield block;
      } finally {
        options.ownership?.release(block);
      }
    }
    logger.debug('Unmatched tool calls detected:', { unmatchedCount });
  } finally {
    index.close();
  }
}
