/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 *
 * Shared helpers for HighDensityStrategy.optimize() test files. Extracted
 * from the original monolithic high-density-optimize.test.ts so no
 * file-level max-lines disable is needed.
 */

import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  DensityConfig,
  DensityResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HighDensityStrategy, PRUNED_POINTER } from '../HighDensityStrategy.js';

// ---------------------------------------------------------------------------
// Call-ID management
// ---------------------------------------------------------------------------

let callIdCounter = 0;

export function nextCallId(): string {
  return `call-${++callIdCounter}`;
}

export function resetCallIds(): void {
  callIdCounter = 0;
}

// ---------------------------------------------------------------------------
// IContent factories
// ---------------------------------------------------------------------------

export function makeHumanMessage(text: string, timestamp?: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

export function makeAiText(text: string, timestamp?: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

export function makeAiToolCall(
  toolName: string,
  parameters: unknown,
  callId?: string,
): { entry: IContent; callId: string } {
  const id = callId ?? nextCallId();
  return {
    entry: {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id,
          name: toolName,
          parameters,
        } as ToolCallBlock,
      ],
      metadata: { timestamp: Date.now() },
    },
    callId: id,
  };
}

export function makeToolResponse(
  callId: string,
  toolName: string,
  result: unknown,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      } as ToolResponseBlock,
    ],
    metadata: { timestamp: Date.now() },
  };
}

/**
 * Build a read-then-write sequence for a given file path.
 * Returns [aiReadEntry, toolReadResponse, aiWriteEntry, toolWriteResponse] and callIds.
 */
export function makeReadWritePair(
  filePath: string,
  readTool = 'read_file',
  writeTool = 'write_file',
): { entries: IContent[]; readCallId: string; writeCallId: string } {
  const readCall = makeAiToolCall(readTool, { file_path: filePath });
  const readResponse = makeToolResponse(
    readCall.callId,
    readTool,
    `contents of ${filePath}`,
  );
  const writeCall = makeAiToolCall(writeTool, { file_path: filePath });
  const writeResponse = makeToolResponse(
    writeCall.callId,
    writeTool,
    `wrote ${filePath}`,
  );
  return {
    entries: [readCall.entry, readResponse, writeCall.entry, writeResponse],
    readCallId: readCall.callId,
    writeCallId: writeCall.callId,
  };
}

export function makeHumanWithFileInclusion(
  filePath: string,
  fileContent: string,
  surroundingText = '',
): IContent {
  const inclusionBlock = `--- ${filePath} ---\n${fileContent}\n--- End of content ---`;
  const text = surroundingText
    ? `${surroundingText}\n${inclusionBlock}`
    : inclusionBlock;
  return makeHumanMessage(text);
}

// ---------------------------------------------------------------------------
// Config and strategy factories
// ---------------------------------------------------------------------------

export function defaultConfig(
  overrides: Partial<DensityConfig> = {},
): DensityConfig {
  return {
    readWritePruning: true,
    fileDedupe: true,
    recencyPruning: true,
    recencyRetention: 3,
    workspaceRoot: '/workspace',
    ...overrides,
  };
}

export function createStrategy(): HighDensityStrategy {
  return new HighDensityStrategy();
}

// ---------------------------------------------------------------------------
// Result inspection helpers
// ---------------------------------------------------------------------------

/**
 * Returns the set of all indices affected by either removal or replacement.
 */
export function allAffectedIndices(result: DensityResult): Set<number> {
  return new Set([...result.removals, ...result.replacements.keys()]);
}

/**
 * Counts how many tool-response entries at the given index are NOT pruned
 * (i.e., the entry is not affected at all, or its replacement still holds a
 * non-pruned result).
 */
export function countUnprunedAtIndex(
  index: number,
  prunedIndices: Set<number>,
  result: DensityResult,
): number {
  if (!prunedIndices.has(index)) {
    return 1;
  }
  if (!result.replacements.has(index)) {
    return 0;
  }
  const replacement = result.replacements.get(index)!;
  const responseBlocks = replacement.blocks.filter(
    (b): b is ToolResponseBlock => b.type === 'tool_response',
  );
  const hasUnpruned = responseBlocks.some((b) => b.result !== PRUNED_POINTER);
  return hasUnpruned ? 1 : 0;
}

/**
 * Extracts tool-response blocks that carry the PRUNED_POINTER from a
 * replacement entry. Returns an empty array when there are none, so callers
 * can assert unconditionally without conditional expectations.
 */
export function getPrunedToolResponses(
  replacement: IContent,
): ToolResponseBlock[] {
  return replacement.blocks
    .filter((b): b is ToolResponseBlock => b.type === 'tool_response')
    .filter((b) => b.result === PRUNED_POINTER);
}
