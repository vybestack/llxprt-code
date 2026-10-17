/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P09
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-004.3, REQ-HD-005.1, REQ-HD-006.1, REQ-HD-007.1
 * @pseudocode high-density-optimize.md
 *
 * High-density compression strategy: performs multi-phase context-window
 * optimization (read/write pair pruning, file deduplication, recency pruning)
 * followed by LLM-based compression of the remaining history.
 *
 * The optimize() pass runs in "continuous" mode — before every threshold check —
 * to reclaim tokens without LLM calls. The compress() pass uses an LLM when
 * the token budget is still exceeded after optimization.
 */

import * as path from 'node:path';
import { optimizeDiskDensity } from './diskDensityOptimization.js';
import { compressHighDensityDisk } from './highDensityDiskPlan.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionStrategy,
  DensityResult,
  DensityConfig,
  StrategyTrigger,
} from '@vybestack/llxprt-code-core/core/compression/types.js';

// ---------------------------------------------------------------------------
// Constants (@pseudocode high-density-optimize.md lines 10-15)
// ---------------------------------------------------------------------------

export const READ_TOOLS = [
  'read_file',
  'read_line_range',
  'read_many_files',
  'ast_read_file',
] as const;
export const WRITE_TOOLS = [
  'write_file',
  'ast_edit',
  'replace',
  'insert_at_line',
  'delete_line_range',
] as const;
/** Shared suffix hint used in both pruned pointers and tool summaries */
export const RERUN_HINT_SUFFIX = '— re-run to view';
export const PRUNED_POINTER = `[Result pruned ${RERUN_HINT_SUFFIX}]`;
export const FILE_INCLUSION_OPEN_REGEX = /^--- (.+) ---$/m;
export const FILE_INCLUSION_CLOSE = '--- End of content ---';

const GLOB_CHARS = ['*', '?'];

// ---------------------------------------------------------------------------
// Helper functions (@pseudocode high-density-optimize.md lines 260-273, 470-471)
// ---------------------------------------------------------------------------

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-005.4, REQ-HD-013.5
 * @pseudocode high-density-optimize.md lines 260-267
 */
function extractFilePath(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) {
    return undefined;
  }
  const p = params as Record<string, unknown>;
  const candidate = p.file_path ?? p.absolute_path ?? p.path;
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }
  return undefined;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-005.5, REQ-HD-005.11
 * @pseudocode high-density-optimize.md lines 270-273
 */
function resolvePath(filePath: string, workspaceRoot: string): string {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  return path.resolve(workspaceRoot, filePath);
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @pseudocode high-density-optimize.md lines 365-393
 */
function findAllInclusions(text: string): Array<{
  filePath: string;
  startOffset: number;
  endOffset: number;
}> {
  const results: Array<{
    filePath: string;
    startOffset: number;
    endOffset: number;
  }> = [];
  const openPattern = /^--- (.+) ---$/gm;
  let match: RegExpExecArray | null;

  while ((match = openPattern.exec(text)) !== null) {
    const filePath = match[1].trim();
    const startOffset = match.index;

    const closeIndex = text.indexOf(
      FILE_INCLUSION_CLOSE,
      startOffset + match[0].length,
    );
    if (closeIndex === -1) {
      continue;
    }

    let endOffset = closeIndex + FILE_INCLUSION_CLOSE.length;
    if (text[endOffset] === '\n') {
      endOffset = endOffset + 1;
    }

    results.push({ filePath, startOffset, endOffset });

    openPattern.lastIndex = endOffset;
  }

  return results;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @pseudocode high-density-optimize.md lines 470-471
 */
function isEmptyTextBlock(block: ContentBlock): boolean {
  return block.type === 'text' && (!block.text || block.text.trim() === '');
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Resolve write-tool target paths for a single AI entry's blocks.
 * Returns resolved paths keyed to the given history index.
 * @pseudocode high-density-optimize.md lines 70-90
 */
function collectLatestWriteIndexes(
  blocks: readonly ContentBlock[],
  workspaceRoot: string,
): string[] {
  return blocks
    .filter(
      (b): b is ToolCallBlock =>
        b.type === 'tool_call' &&
        (WRITE_TOOLS as readonly string[]).includes(b.name),
    )
    .map((b) => extractFilePath(b.parameters))
    .filter((fp): fp is string => fp !== undefined)
    .map((fp) => resolvePath(fp, workspaceRoot));
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Build latest write map — latest write index per file path.
 * @pseudocode high-density-optimize.md lines 60-90
 */
function buildLatestWriteMap(
  history: readonly IContent[],
  config: DensityConfig,
): Map<string, number> {
  const latestWrite = new Map<string, number>();

  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry.speaker !== 'ai') {
      continue;
    }

    collectLatestWriteIndexes(entry.blocks, config.workspaceRoot).forEach(
      (resolved) => {
        if (!latestWrite.has(resolved)) {
          latestWrite.set(resolved, index);
        }
      },
    );
  }

  return latestWrite;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Identify stale read tool calls by comparing against the latest write map.
 * @pseudocode high-density-optimize.md lines 100-160
 */
function identifyStaleReadCalls(
  history: readonly IContent[],
  config: DensityConfig,
  latestWrite: Map<string, number>,
  strategy: HighDensityStrategy,
): {
  staleCallIds: Set<string>;
  aiEntryStaleBlocks: Map<number, Set<string>>;
  aiEntryTotalToolCalls: Map<number, number>;
} {
  const staleCallIds = new Set<string>();
  const aiEntryStaleBlocks = new Map<number, Set<string>>();
  const aiEntryTotalToolCalls = new Map<number, number>();

  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (entry.speaker !== 'ai') {
      continue;
    }

    const toolCallBlocks = entry.blocks.filter(
      (b): b is ToolCallBlock => b.type === 'tool_call',
    );
    aiEntryTotalToolCalls.set(index, toolCallBlocks.length);

    const staleBlockIds = identifyStaleReadBlocksForEntry(
      toolCallBlocks,
      config.workspaceRoot,
      latestWrite,
      index,
      strategy,
    );
    if (staleBlockIds.size > 0) {
      staleBlockIds.forEach((id) => staleCallIds.add(id));
      aiEntryStaleBlocks.set(index, staleBlockIds);
    }
  }

  return { staleCallIds, aiEntryStaleBlocks, aiEntryTotalToolCalls };
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Determine which read-tool-call blocks in a single AI entry are stale.
 * @pseudocode high-density-optimize.md lines 100-160
 */
function identifyStaleReadBlocksForEntry(
  toolCallBlocks: ToolCallBlock[],
  workspaceRoot: string,
  latestWrite: Map<string, number>,
  index: number,
  strategy: HighDensityStrategy,
): Set<string> {
  return new Set(
    toolCallBlocks
      .filter((b) => (READ_TOOLS as readonly string[]).includes(b.name))
      .filter((b) =>
        isStaleReadCall(b, workspaceRoot, latestWrite, index, strategy),
      )
      .map((b) => b.id),
  );
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Check whether a single read-tool-call block is stale (superseded by a later write).
 * @pseudocode high-density-optimize.md lines 110-155
 */
function isStaleReadCall(
  block: ToolCallBlock,
  workspaceRoot: string,
  latestWrite: Map<string, number>,
  index: number,
  strategy: HighDensityStrategy,
): boolean {
  if (block.name === 'read_many_files') {
    return strategy.canPruneReadManyFiles(
      block.parameters,
      workspaceRoot,
      latestWrite,
      index,
    );
  }
  const filePath = extractFilePath(block.parameters);
  if (filePath === undefined) {
    return false;
  }
  const resolved = resolvePath(filePath, workspaceRoot);
  const writeIndex = latestWrite.get(resolved);
  return writeIndex !== undefined && writeIndex > index;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Process AI entries with stale tool calls — remove or replace.
 * @pseudocode high-density-optimize.md lines 162-180
 */
function applyStaleAiEntries(
  history: readonly IContent[],
  aiEntryStaleBlocks: Map<number, Set<string>>,
  aiEntryTotalToolCalls: Map<number, number>,
  removals: Set<number>,
  replacements: Map<number, IContent>,
): void {
  for (const [aiIndex, staleCalls] of aiEntryStaleBlocks) {
    const totalCalls = aiEntryTotalToolCalls.get(aiIndex) ?? 0;

    const filteredBlocks = history[aiIndex].blocks.filter(
      (b) => b.type !== 'tool_call' || !staleCalls.has(b.id),
    );

    if (
      staleCalls.size === totalCalls &&
      (filteredBlocks.length === 0 ||
        filteredBlocks.every((b) => isEmptyTextBlock(b)))
    ) {
      removals.add(aiIndex);
    } else {
      replacements.set(aiIndex, {
        ...history[aiIndex],
        blocks: filteredBlocks,
      });
    }
  }
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Process tool entries — remove tool_response blocks for stale callIds.
 * Returns the number of pruned responses.
 * @pseudocode high-density-optimize.md lines 185-209
 */
function applyStaleToolEntries(
  history: readonly IContent[],
  staleCallIds: Set<string>,
  removals: Set<number>,
  replacements: Map<number, IContent>,
): number {
  let prunedCount = 0;

  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (entry.speaker !== 'tool' || removals.has(index)) {
      continue;
    }

    const pruned = applyStaleToolEntry(
      index,
      entry,
      staleCallIds,
      removals,
      replacements,
    );
    prunedCount = prunedCount + pruned;
  }

  return prunedCount;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Process a single tool entry — remove or replace stale tool_response blocks.
 * Returns the number of pruned responses for this entry (0 if none stale).
 * @pseudocode high-density-optimize.md lines 185-209
 */
function applyStaleToolEntry(
  index: number,
  entry: IContent,
  staleCallIds: Set<string>,
  removals: Set<number>,
  replacements: Map<number, IContent>,
): number {
  const responseBlocks = entry.blocks.filter(
    (b): b is ToolResponseBlock => b.type === 'tool_response',
  );
  const staleResponses = responseBlocks.filter((b) =>
    staleCallIds.has(b.callId),
  );

  if (staleResponses.length === 0) {
    return 0;
  }

  if (
    staleResponses.length === responseBlocks.length &&
    entry.blocks.every((b) => b.type === 'tool_response')
  ) {
    removals.add(index);
    return staleResponses.length;
  }

  const filteredBlocks = entry.blocks.filter(
    (b) => b.type !== 'tool_response' || !staleCallIds.has(b.callId),
  );
  if (filteredBlocks.length === 0) {
    removals.add(index);
  } else {
    replacements.set(index, {
      ...entry,
      blocks: filteredBlocks,
    });
  }
  return staleResponses.length;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Inclusion location tracked per human-message text block.
 */
type InclusionEntry = {
  messageIndex: number;
  blockIndex: number;
  startOffset: number;
  endOffset: number;
};

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-006.1
 * Scan human messages for file inclusions, grouped by resolved file path.
 * @pseudocode high-density-optimize.md lines 280-310
 */
function scanFileInclusions(
  history: readonly IContent[],
  config: DensityConfig,
  existingRemovals: Set<number>,
): Map<string, InclusionEntry[]> {
  const inclusions = new Map<string, InclusionEntry[]>();

  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (entry.speaker !== 'human' || existingRemovals.has(index)) {
      continue;
    }

    collectEntryInclusions(entry.blocks, index, config.workspaceRoot).forEach(
      (inc) => {
        const list = inclusions.get(inc.resolvedFilePath) ?? [];
        list.push(inc.entry);
        inclusions.set(inc.resolvedFilePath, list);
      },
    );
  }

  return inclusions;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Collect file inclusions from a single human entry's text blocks.
 * @pseudocode high-density-optimize.md lines 285-310
 */
function collectEntryInclusions(
  blocks: readonly ContentBlock[],
  messageIndex: number,
  workspaceRoot: string,
): Array<{ resolvedFilePath: string; entry: InclusionEntry }> {
  const results: Array<{ resolvedFilePath: string; entry: InclusionEntry }> =
    [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    if (block.type !== 'text') {
      continue;
    }
    const matches = findAllInclusions(block.text);
    for (const match of matches) {
      results.push({
        resolvedFilePath: resolvePath(match.filePath, workspaceRoot),
        entry: {
          messageIndex,
          blockIndex,
          startOffset: match.startOffset,
          endOffset: match.endOffset,
        },
      });
    }
  }
  return results;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-006.2
 * Collect all stale inclusions (all-but-latest per file), group by block key.
 * @pseudocode high-density-optimize.md lines 312-330
 */
function collectStaleInclusions(
  inclusions: Map<string, InclusionEntry[]>,
): Map<string, InclusionEntry[]> {
  const staleByBlock = new Map<string, InclusionEntry[]>();

  for (const [, entries] of inclusions) {
    if (entries.length <= 1) {
      continue;
    }

    entries.sort((a, b) => {
      const messageDiff = b.messageIndex - a.messageIndex;
      return messageDiff !== 0 ? messageDiff : b.startOffset - a.startOffset;
    });

    // entries[0] is the latest — preserve. Strip entries[1..n]
    for (let i = 1; i < entries.length; i++) {
      const stale = entries[i];
      const key = `${stale.messageIndex}:${stale.blockIndex}`;
      if (!staleByBlock.has(key)) {
        staleByBlock.set(key, []);
      }
      staleByBlock.get(key)!.push(stale);
    }
  }

  return staleByBlock;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-006.3, REQ-HD-006.4, REQ-HD-006.5
 * Apply all stale removals per block in descending offset order.
 * Returns updated prunedCount.
 * @pseudocode high-density-optimize.md lines 332-359
 */
function applyStaleInclusionRemovals(
  staleByBlock: Map<string, InclusionEntry[]>,
  history: readonly IContent[],
  replacements: Map<number, IContent>,
  prunedCount: number,
): number {
  let count = prunedCount;

  for (const [, stales] of staleByBlock) {
    stales.sort((a, b) => b.startOffset - a.startOffset);

    const { messageIndex, blockIndex } = stales[0];
    const originalEntry =
      replacements.get(messageIndex) ?? history[messageIndex];
    const originalBlock = originalEntry.blocks[blockIndex];
    if (originalBlock.type !== 'text') {
      continue;
    }

    let newText = originalBlock.text;
    for (const stale of stales) {
      newText =
        newText.substring(0, stale.startOffset) +
        newText.substring(stale.endOffset);
      count = count + 1;
    }

    newText = newText.replace(/\n{3,}/g, '\n\n');

    const newBlocks = [...originalEntry.blocks];
    newBlocks[blockIndex] = { type: 'text' as const, text: newText };

    replacements.set(messageIndex, {
      ...originalEntry,
      blocks: newBlocks,
    });
  }

  return count;
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Classify a single read_many_files path for pruning eligibility.
 * @pseudocode high-density-optimize.md lines 220-250
 */
function classifyReadManyFilesPath(
  filePath: string,
  workspaceRoot: string,
  latestWrite: Map<string, number>,
  readIndex: number,
): 'glob' | 'concrete-with-write' | 'concrete-without-write' {
  if (GLOB_CHARS.some((c) => filePath.includes(c))) {
    return 'glob';
  }
  const resolved = resolvePath(filePath, workspaceRoot);
  const writeIndex = latestWrite.get(resolved);
  if (writeIndex === undefined || writeIndex <= readIndex) {
    return 'concrete-without-write';
  }
  return 'concrete-with-write';
}

/**
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * Walk a tool entry's blocks in reverse, counting per-tool responses and
 * returning those exceeding the retention threshold. Mutates toolCounts.
 * @pseudocode high-density-optimize.md lines 410-440
 */
function findPrunableToolResponses(
  blocks: readonly ContentBlock[],
  toolCounts: Map<string, number>,
  retention: number,
): number[] {
  const prunable: number[] = [];
  for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex--) {
    const block = blocks[blockIndex];
    if (block.type !== 'tool_response' || block.result === PRUNED_POINTER) {
      continue;
    }
    const toolName = block.toolName;
    const currentCount = (toolCounts.get(toolName) ?? 0) + 1;
    toolCounts.set(toolName, currentCount);
    if (currentCount > retention) {
      prunable.push(blockIndex);
    }
  }
  return prunable;
}

// ---------------------------------------------------------------------------
// HighDensityStrategy
// ---------------------------------------------------------------------------

/**
 * @plan PLAN-20260211-HIGHDENSITY.P09
 * @plan PLAN-20260211-HIGHDENSITY.P11
 * @requirement REQ-HD-004.3
 * @pseudocode high-density-optimize.md lines 20-53
 */
export class HighDensityStrategy implements CompressionStrategy {
  readonly optimizeRows = optimizeDiskDensity;
  readonly diskCompressionOwnership = new RowOwnership();
  readonly compressDisk = (
    context: Parameters<typeof compressHighDensityDisk>[0],
    candidate: HistoryDensityRows,
  ): ReturnType<typeof compressHighDensityDisk> =>
    compressHighDensityDisk(context, candidate, this.diskCompressionOwnership);
  readonly name = 'high-density' as const;
  readonly requiresLLM = false;
  readonly trigger: StrategyTrigger = {
    mode: 'continuous',
    defaultThreshold: 0.6,
  };

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P11
   * @requirement REQ-HD-005.1, REQ-HD-006.1, REQ-HD-007.1, REQ-HD-013.7
   * @pseudocode high-density-optimize.md lines 20-53
   */
  optimize(history: readonly IContent[], config: DensityConfig): DensityResult {
    const removals = new Set<number>();
    const replacements = new Map<number, IContent>();
    let readWritePairsPruned = 0;
    let fileDeduplicationsPruned = 0;
    let recencyPruned = 0;

    // Phase 1: READ→WRITE pair pruning
    if (config.readWritePruning) {
      const rwResult = this.pruneReadWritePairs(history, config);
      for (const idx of rwResult.removals) {
        removals.add(idx);
      }
      for (const [idx, entry] of rwResult.replacements) {
        if (!removals.has(idx)) {
          replacements.set(idx, entry);
        }
      }
      readWritePairsPruned = rwResult.prunedCount;
    }

    // Phase 2: Duplicate @ file inclusion dedup
    if (config.fileDedupe) {
      const ddResult = this.deduplicateFileInclusions(
        history,
        config,
        removals,
      );
      for (const [idx, entry] of ddResult.replacements) {
        if (!removals.has(idx)) {
          replacements.set(idx, entry);
        }
      }
      fileDeduplicationsPruned = ddResult.prunedCount;
    }

    // Phase 3: Tool result recency pruning
    // Apply prior replacements so recency pruning sees already-pruned entries
    if (config.recencyPruning) {
      const historyForRecency = history.map(
        (entry, idx) => replacements.get(idx) ?? entry,
      );
      const rpResult = this.pruneByRecency(historyForRecency, config, removals);
      for (const [idx, entry] of rpResult.replacements) {
        if (!removals.has(idx)) {
          replacements.set(idx, entry);
        }
      }
      recencyPruned = rpResult.prunedCount;
    }

    return {
      removals: Array.from(removals),
      replacements: replacements as ReadonlyMap<number, IContent>,
      metadata: {
        readWritePairsPruned,
        fileDeduplicationsPruned,
        recencyPruned,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers — optimize phase
  // -------------------------------------------------------------------------

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P11
   * @requirement REQ-HD-005.1, REQ-HD-005.2, REQ-HD-005.3, REQ-HD-005.6,
   *              REQ-HD-005.7, REQ-HD-005.8, REQ-HD-005.9
   * @pseudocode high-density-optimize.md lines 60-209
   */
  private pruneReadWritePairs(
    history: readonly IContent[],
    config: DensityConfig,
  ): {
    removals: Set<number>;
    replacements: Map<number, IContent>;
    prunedCount: number;
  } {
    const removals = new Set<number>();
    const replacements = new Map<number, IContent>();
    let prunedCount = 0;

    const latestWrite = buildLatestWriteMap(history, config);
    const { staleCallIds, aiEntryStaleBlocks, aiEntryTotalToolCalls } =
      identifyStaleReadCalls(history, config, latestWrite, this);

    applyStaleAiEntries(
      history,
      aiEntryStaleBlocks,
      aiEntryTotalToolCalls,
      removals,
      replacements,
    );

    prunedCount = applyStaleToolEntries(
      history,
      staleCallIds,
      removals,
      replacements,
    );

    return { removals, replacements, prunedCount };
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P11
   * @requirement REQ-HD-005.9
   * @pseudocode high-density-optimize.md lines 215-255
   */
  canPruneReadManyFiles(
    params: unknown,
    workspaceRoot: string,
    latestWrite: Map<string, number>,
    readIndex: number,
  ): boolean {
    if (typeof params !== 'object' || params === null) {
      return false;
    }

    const p = params as Record<string, unknown>;
    const paths = p.paths;
    if (!Array.isArray(paths)) {
      return false;
    }

    let hasGlob = false;
    let allConcreteHaveWrite = true;
    let hasAnyConcrete = false;

    for (const filePath of paths) {
      if (typeof filePath !== 'string') {
        continue;
      }
      const classification = classifyReadManyFilesPath(
        filePath,
        workspaceRoot,
        latestWrite,
        readIndex,
      );
      if (classification === 'glob') {
        hasGlob = true;
      }
      if (
        classification === 'concrete-with-write' ||
        classification === 'concrete-without-write'
      ) {
        hasAnyConcrete = true;
      }
      if (classification === 'concrete-without-write') {
        allConcreteHaveWrite = false;
      }
    }

    if (hasGlob) {
      return false;
    }
    if (!hasAnyConcrete) {
      return false;
    }
    return allConcreteHaveWrite;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P11
   * @requirement REQ-HD-006.1, REQ-HD-006.2, REQ-HD-006.3, REQ-HD-006.4, REQ-HD-006.5
   * @pseudocode high-density-optimize.md lines 280-359
   */
  private deduplicateFileInclusions(
    history: readonly IContent[],
    config: DensityConfig,
    existingRemovals: Set<number>,
  ): { replacements: Map<number, IContent>; prunedCount: number } {
    const replacements = new Map<number, IContent>();
    let prunedCount = 0;

    const inclusions = scanFileInclusions(history, config, existingRemovals);
    const staleByBlock = collectStaleInclusions(inclusions);
    prunedCount = applyStaleInclusionRemovals(
      staleByBlock,
      history,
      replacements,
      prunedCount,
    );

    return { replacements, prunedCount };
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P11
   * @requirement REQ-HD-007.1, REQ-HD-007.2, REQ-HD-007.3, REQ-HD-007.4,
   *              REQ-HD-007.6, REQ-HD-013.6
   * @pseudocode high-density-optimize.md lines 400-464
   */
  private pruneByRecency(
    history: readonly IContent[],
    config: DensityConfig,
    existingRemovals: Set<number>,
  ): { replacements: Map<number, IContent>; prunedCount: number } {
    const replacements = new Map<number, IContent>();
    let prunedCount = 0;
    const retention = Math.max(1, config.recencyRetention);

    // STEP 1: Count tool responses per tool name, walking in reverse
    const toolCounts = new Map<string, number>();
    const entriesToPrune: Array<{ index: number; blockIndex: number }> = [];

    for (let index = history.length - 1; index >= 0; index--) {
      const entry = history[index];
      if (entry.speaker !== 'tool' || existingRemovals.has(index)) {
        continue;
      }

      for (const blockIndex of findPrunableToolResponses(
        entry.blocks,
        toolCounts,
        retention,
      )) {
        entriesToPrune.push({ index, blockIndex });
      }
    }

    // STEP 2: Build replacements — group by entry index
    const grouped = new Map<number, Set<number>>();

    for (const { index, blockIndex } of entriesToPrune) {
      if (!grouped.has(index)) {
        grouped.set(index, new Set());
      }
      grouped.get(index)!.add(blockIndex);
    }

    for (const [entryIndex, blockIndices] of grouped) {
      const entry = replacements.get(entryIndex) ?? history[entryIndex];
      const newBlocks = entry.blocks.map((block, bi) => {
        if (blockIndices.has(bi) && block.type === 'tool_response') {
          return {
            ...block,
            result: PRUNED_POINTER,
          };
        }
        return block;
      });

      replacements.set(entryIndex, {
        ...entry,
        blocks: newBlocks,
      });
      prunedCount = prunedCount + blockIndices.size;
    }

    return { replacements, prunedCount };
  }
}
