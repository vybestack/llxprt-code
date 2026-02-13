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
import type {
  IContent,
  ContentBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import type {
  CompressionStrategy,
  CompressionContext,
  CompressionResult,
  CompressionResultMetadata,
  DensityResult,
  DensityConfig,
  StrategyTrigger,
} from './types.js';

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
export const PRUNED_POINTER = '[Result pruned — re-run tool to retrieve]';
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
  readonly name = 'high-density' as const;
  readonly requiresLLM = false;
  readonly trigger: StrategyTrigger = {
    mode: 'continuous',
    defaultThreshold: 0.85,
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

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.1, REQ-HD-008.2, REQ-HD-008.3, REQ-HD-008.4, REQ-HD-008.5, REQ-HD-008.6
   * @pseudocode high-density-compress.md lines 10-91
   *
   * Deterministic (no-LLM) compression:
   * 1. Calculate tail size from preserveThreshold
   * 2. Calculate target token budget
   * 3. Summarize tool responses in the head
   * 4. Truncate oldest entries if still over budget
   * 5. Return CompressionResult with metadata
   */
  async compress(context: CompressionContext): Promise<CompressionResult> {
    const history = context.history;
    const originalCount = history.length;

    // Edge case: empty history
    if (originalCount === 0) {
      return {
        newHistory: [],
        metadata: this.buildMetadata(0, 0),
      };
    }

    // STEP 1: Calculate tail size from preserveThreshold (@pseudocode lines 21-27)
    const preserveThreshold =
      context.runtimeContext.ephemerals.preserveThreshold();
    const tailSize = Math.max(1, Math.floor(originalCount * preserveThreshold));
    let tailStartIndex = originalCount - tailSize;

    // Adjust for tool_call boundary — expand tail backward to avoid splitting pairs
    tailStartIndex = this.adjustTailBoundary(history, tailStartIndex);

    // If tail covers everything, return history unchanged (@pseudocode lines 29-34)
    if (tailStartIndex <= 0) {
      return {
        newHistory: [...history] as IContent[],
        metadata: this.buildMetadata(originalCount, originalCount),
      };
    }

    // STEP 2: Calculate target tokens (@pseudocode lines 36-39)
    const compressionThreshold =
      context.runtimeContext.ephemerals.compressionThreshold();
    const contextLimit = context.runtimeContext.ephemerals.contextLimit();
    const compressHeadroom =
      context.runtimeContext.ephemerals.densityCompressHeadroom();
    const targetTokens = Math.floor(
      compressionThreshold * contextLimit * compressHeadroom,
    );

    context.logger.debug(
      `[HighDensity compress] originalCount=${originalCount} tailStart=${tailStartIndex} target=${targetTokens}`,
    );

    // STEP 3: Build new history — process head + preserve tail (@pseudocode lines 48-74)
    const newHistory: IContent[] = [];

    // 3a: Process entries before tail
    for (let i = 0; i < tailStartIndex; i++) {
      const entry = history[i];
      if (entry.speaker === 'human' || entry.speaker === 'ai') {
        // Preserve human and AI entries intact (REQ-HD-008.4)
        newHistory.push(entry as IContent);
      } else if (entry.speaker === 'tool') {
        // Summarize tool response blocks (REQ-HD-008.3)
        const summarized = this.summarizeToolResponseBlocks(entry, history);
        newHistory.push(summarized);
      }
    }

    // 3b: Push tail entries intact (REQ-HD-008.2)
    for (let i = tailStartIndex; i < originalCount; i++) {
      newHistory.push(history[i] as IContent);
    }

    // STEP 4: Truncate if still over target (@pseudocode lines 76-85)
    const finalHistory = await this.truncateToTarget(
      newHistory,
      newHistory.length - (originalCount - tailStartIndex),
      targetTokens,
      context,
    );

    // STEP 5: Return result (@pseudocode lines 87-91)
    return {
      newHistory: finalHistory,
      metadata: this.buildMetadata(originalCount, finalHistory.length),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers — compress phase
  // -------------------------------------------------------------------------

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.2
   * @pseudocode high-density-compress.md line 27
   *
   * Adjust the tail boundary backward to avoid splitting tool_call/response
   * pairs. If the boundary lands on a tool_response, move it back to include
   * the preceding AI tool_call entry as well.
   */
  private adjustTailBoundary(
    history: readonly IContent[],
    index: number,
  ): number {
    if (index <= 0 || index >= history.length) {
      return index;
    }

    // If the entry at index is a tool_response, move backward to include
    // any preceding tool entries and their AI tool_call
    while (index > 0 && history[index].speaker === 'tool') {
      index--;
    }
    // If we landed on an AI entry with tool_calls, include it only if
    // its tool responses are in the tail (to avoid orphaning the call)
    if (index > 0 && history[index].speaker === 'ai') {
      const toolCallIds = history[index].blocks
        .filter((b): b is ToolCallBlock => b.type === 'tool_call')
        .map((b) => b.id);
      if (toolCallIds.length > 0) {
        const tailHasResponses = toolCallIds.some((id) =>
          history
            .slice(index + 1)
            .some(
              (e) =>
                e.speaker === 'tool' &&
                e.blocks.some(
                  (b) =>
                    b.type === 'tool_response' &&
                    (b as ToolResponseBlock).callId === id,
                ),
            ),
        );
        if (!tailHasResponses) {
          index++;
        }
      }
    }
    return index;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.3
   * @pseudocode high-density-compress.md lines 100-112
   *
   * Replace tool_response block results with compact one-line summaries.
   * Non-tool_response blocks are passed through unchanged.
   */
  private summarizeToolResponseBlocks(
    entry: IContent,
    fullHistory: readonly IContent[],
  ): IContent {
    const newBlocks: ContentBlock[] = entry.blocks.map((block) => {
      if (block.type !== 'tool_response') {
        return block;
      }
      return {
        ...block,
        result: this.buildToolSummaryText(
          block as ToolResponseBlock,
          fullHistory,
        ),
      } as ToolResponseBlock;
    });
    return { ...entry, blocks: newBlocks } as IContent;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.3
   * @pseudocode high-density-compress.md lines 120-149
   *
   * Build a compact summary string for a tool response block.
   * Format: `[toolName keyParam: status]`
   */
  private buildToolSummaryText(
    block: ToolResponseBlock,
    fullHistory: readonly IContent[],
  ): string {
    const toolName = block.toolName;

    // Determine status: error if error field present or result contains error indicators
    const hasError = block.error !== undefined && block.error !== '';
    const resultStr =
      typeof block.result === 'string'
        ? block.result
        : JSON.stringify(block.result ?? '');
    const looksLikeError =
      !hasError &&
      (resultStr.toLowerCase().includes('error:') ||
        resultStr.toLowerCase().includes('error occurred') ||
        resultStr.toLowerCase().includes('command failed'));
    const outcome = hasError || looksLikeError ? 'error' : 'success';

    // Extract key param — look for matching tool_call by callId
    let keyParam: string | undefined;
    for (const entry of fullHistory) {
      if (entry.speaker !== 'ai') continue;
      for (const b of entry.blocks) {
        if (
          b.type === 'tool_call' &&
          (b as ToolCallBlock).id === block.callId
        ) {
          const params = (b as ToolCallBlock).parameters;
          keyParam = extractFilePath(params);
          break;
        }
      }
      if (keyParam !== undefined) break;
    }

    if (keyParam) {
      return `[${toolName} ${keyParam}: ${outcome}]`;
    }
    return `[${toolName}: ${outcome}]`;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.6
   * @pseudocode high-density-compress.md lines 155-175
   *
   * Remove oldest head entries until the estimated token count is
   * at or below the target. Never removes tail entries.
   */
  private async truncateToTarget(
    history: IContent[],
    headEnd: number,
    targetTokens: number,
    context: CompressionContext,
  ): Promise<IContent[]> {
    let removeCount = 0;
    let estimatedTokens = await context.estimateTokens(history);

    while (estimatedTokens > targetTokens && removeCount < headEnd) {
      removeCount++;
      estimatedTokens = await context.estimateTokens(
        history.slice(removeCount),
      );
    }

    return removeCount > 0 ? history.slice(removeCount) : history;
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P14
   * @requirement REQ-HD-008.5
   * @pseudocode high-density-compress.md lines 180-193
   */
  private buildMetadata(
    originalMessageCount: number,
    compressedMessageCount: number,
  ): CompressionResultMetadata {
    return {
      originalMessageCount,
      compressedMessageCount,
      strategyUsed: 'high-density',
      llmCallMade: false,
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

    // STEP 1: Build write map — latest write index per file path
    const latestWrite = new Map<string, number>();

    for (let index = history.length - 1; index >= 0; index--) {
      const entry = history[index];
      if (entry.speaker !== 'ai') {
        continue;
      }

      for (const block of entry.blocks) {
        if (block.type !== 'tool_call') {
          continue;
        }
        if (!(WRITE_TOOLS as readonly string[]).includes(block.name)) {
          continue;
        }

        const filePath = extractFilePath(block.parameters);
        if (filePath === undefined) {
          continue;
        }

        const resolved = resolvePath(filePath, config.workspaceRoot);
        if (!latestWrite.has(resolved)) {
          latestWrite.set(resolved, index);
        }
      }
    }

    // STEP 2: Build tool call → history index mapping
    const callMap = new Map<
      string,
      { aiIndex: number; toolCallBlock: ToolCallBlock }
    >();

    for (let index = 0; index < history.length; index++) {
      const entry = history[index];
      if (entry.speaker === 'ai') {
        for (const block of entry.blocks) {
          if (block.type === 'tool_call') {
            callMap.set(block.id, { aiIndex: index, toolCallBlock: block });
          }
        }
      }
    }

    // STEP 3: Identify stale read tool calls
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

      for (const block of toolCallBlocks) {
        if (!(READ_TOOLS as readonly string[]).includes(block.name)) {
          continue;
        }

        if (block.name === 'read_many_files') {
          const canPrune = this.canPruneReadManyFiles(
            block.parameters,
            config.workspaceRoot,
            latestWrite,
            index,
          );
          if (!canPrune) {
            continue;
          }
        } else {
          const filePath = extractFilePath(block.parameters);
          if (filePath === undefined) {
            continue;
          }

          const resolved = resolvePath(filePath, config.workspaceRoot);
          const writeIndex = latestWrite.get(resolved);

          if (writeIndex === undefined || writeIndex <= index) {
            continue;
          }
        }

        // This read is stale
        staleCallIds.add(block.id);
        if (!aiEntryStaleBlocks.has(index)) {
          aiEntryStaleBlocks.set(index, new Set());
        }
        aiEntryStaleBlocks.get(index)!.add(block.id);
      }
    }

    // STEP 4a: Process AI entries with stale tool calls
    for (const [aiIndex, staleCalls] of aiEntryStaleBlocks) {
      const totalCalls = aiEntryTotalToolCalls.get(aiIndex) ?? 0;

      const filteredBlocks = history[aiIndex].blocks.filter(
        (b) =>
          b.type !== 'tool_call' || !staleCalls.has((b as ToolCallBlock).id),
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

    // STEP 4b: Process tool entries — remove tool_response blocks for stale callIds
    for (let index = 0; index < history.length; index++) {
      const entry = history[index];
      if (entry.speaker !== 'tool') {
        continue;
      }
      if (removals.has(index)) {
        continue;
      }

      const responseBlocks = entry.blocks.filter(
        (b): b is ToolResponseBlock => b.type === 'tool_response',
      );
      const staleResponses = responseBlocks.filter((b) =>
        staleCallIds.has(b.callId),
      );

      if (staleResponses.length === 0) {
        continue;
      }

      if (
        staleResponses.length === responseBlocks.length &&
        entry.blocks.every((b) => b.type === 'tool_response')
      ) {
        removals.add(index);
        prunedCount = prunedCount + staleResponses.length;
      } else {
        const filteredBlocks = entry.blocks.filter(
          (b) =>
            b.type !== 'tool_response' ||
            !staleCallIds.has((b as ToolResponseBlock).callId),
        );
        if (filteredBlocks.length === 0) {
          removals.add(index);
        } else {
          replacements.set(index, {
            ...entry,
            blocks: filteredBlocks,
          });
        }
        prunedCount = prunedCount + staleResponses.length;
      }
    }

    return { removals, replacements, prunedCount };
  }

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P11
   * @requirement REQ-HD-005.9
   * @pseudocode high-density-optimize.md lines 215-255
   */
  private canPruneReadManyFiles(
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

      if (GLOB_CHARS.some((c) => filePath.includes(c))) {
        hasGlob = true;
        continue;
      }

      hasAnyConcrete = true;
      const resolved = resolvePath(filePath, workspaceRoot);
      const writeIndex = latestWrite.get(resolved);
      if (writeIndex === undefined || writeIndex <= readIndex) {
        allConcreteHaveWrite = false;
        break;
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

    // STEP 1: Scan human messages for @ file inclusions
    const inclusions = new Map<
      string,
      Array<{
        messageIndex: number;
        blockIndex: number;
        startOffset: number;
        endOffset: number;
      }>
    >();

    for (let index = 0; index < history.length; index++) {
      const entry = history[index];
      if (entry.speaker !== 'human') {
        continue;
      }
      if (existingRemovals.has(index)) {
        continue;
      }

      for (let blockIndex = 0; blockIndex < entry.blocks.length; blockIndex++) {
        const block = entry.blocks[blockIndex];
        if (block.type !== 'text') {
          continue;
        }

        const text = block.text;
        const matches = findAllInclusions(text);

        for (const match of matches) {
          const resolvedFilePath = resolvePath(
            match.filePath,
            config.workspaceRoot,
          );
          if (!inclusions.has(resolvedFilePath)) {
            inclusions.set(resolvedFilePath, []);
          }
          inclusions.get(resolvedFilePath)!.push({
            messageIndex: index,
            blockIndex,
            startOffset: match.startOffset,
            endOffset: match.endOffset,
          });
        }
      }
    }

    // STEP 2: Collect all stale inclusions (all-but-latest per file), group by block
    const staleByBlock = new Map<
      string,
      Array<{
        messageIndex: number;
        blockIndex: number;
        startOffset: number;
        endOffset: number;
      }>
    >();
    for (const [, entries] of inclusions) {
      if (entries.length <= 1) {
        continue;
      }

      entries.sort(
        (a, b) =>
          b.messageIndex - a.messageIndex || b.startOffset - a.startOffset,
      );

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

    // Apply all stale removals per block in descending offset order
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
        prunedCount = prunedCount + 1;
      }

      newText = newText.replace(/\n{3,}/g, '\n\n');

      const newBlocks = [...originalEntry.blocks];
      newBlocks[blockIndex] = { type: 'text' as const, text: newText };

      replacements.set(messageIndex, {
        ...originalEntry,
        blocks: newBlocks,
      });
    }

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
      if (entry.speaker !== 'tool') {
        continue;
      }
      if (existingRemovals.has(index)) {
        continue;
      }

      for (
        let blockIndex = entry.blocks.length - 1;
        blockIndex >= 0;
        blockIndex--
      ) {
        const block = entry.blocks[blockIndex];
        if (block.type !== 'tool_response') {
          continue;
        }

        // Skip already-pruned results to ensure idempotency
        if (block.result === PRUNED_POINTER) {
          continue;
        }

        const toolName = block.toolName;
        let currentCount = toolCounts.get(toolName) ?? 0;
        currentCount = currentCount + 1;
        toolCounts.set(toolName, currentCount);

        if (currentCount > retention) {
          entriesToPrune.push({ index, blockIndex });
        }
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
