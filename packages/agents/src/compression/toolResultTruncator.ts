/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import {
  blockToTokenFallbackString,
  simpleTokenEstimateForText,
} from '@vybestack/llxprt-code-core/services/history/historyTokenEstimation.js';

export const CONTEXT_TRUNCATION_MARKER = 'contextTruncated';

export interface RankedToolResponse {
  readonly entryIndex: number;
  readonly blockIndex: number;
  readonly block: ToolResponseBlock;
  readonly estimatedTokens: number;
}

export interface ToolResponseTruncationResult {
  readonly replacedCount: number;
  readonly projected: number;
  readonly success: boolean;
}

export interface ToolResultTruncatorDeps {
  readonly historyService: HistoryService;
  readonly logger: DebugLogger;
  /**
   * Async, model-aware token estimator for ranking candidates. This enables
   * model-dependent fattest-first ordering (e.g. a model whose tokenizer
   * counts certain payloads differently produces a different ranking than a
   * generic char/4 heuristic).
   */
  readonly estimateBlockTokensAsync: (block: ContentBlock) => Promise<number>;
  /**
   * Projection after each replacement. On the pending path this uses the
   * synchronous pending-token projection; on the provider path it uses an
   * async provider-content projection. Both paths share this single sound
   * utility.
   */
  readonly computeProjected: () => number | Promise<number>;
  readonly resetBaseline: () => void;
  readonly getRuntimeModel: () => string;
}

export function isAlreadyStubbed(block: ToolResponseBlock): boolean {
  const meta = block.providerMetadata;
  if (!meta) {
    return false;
  }
  return meta[CONTEXT_TRUNCATION_MARKER] === true;
}

export function createTruncationStub(
  original: ToolResponseBlock,
  originalTokens: number,
): ToolResponseBlock {
  const providerMetadata = {
    ...(original.providerMetadata ?? {}),
    [CONTEXT_TRUNCATION_MARKER]: true,
    contextTruncatedOriginalTokens: originalTokens,
  };

  if (original.error !== undefined) {
    return {
      type: 'tool_response',
      callId: original.callId,
      toolName: original.toolName,
      result: null,
      error: `[Tool error output truncated — original error was ~${originalTokens} tokens which exceeded the remaining context budget. The tool execution failed.]`,
      isComplete: true,
      providerMetadata,
    };
  }

  return {
    type: 'tool_response',
    callId: original.callId,
    toolName: original.toolName,
    result: `[Tool output truncated — original output was ~${originalTokens} tokens which exceeded the remaining context budget. The tool executed successfully. Re-request with a smaller scope if you need this content.]`,
    isComplete: true,
    providerMetadata,
  };
}

/**
 * Rank tool-response candidates by estimated token size (fattest first),
 * breaking ties by recency (most recent first).
 *
 * Accepts an async estimator so the ranking can reflect the active
 * provider/runtime model's tokenization rather than a static heuristic.
 */
export async function rankToolResponses(
  history: readonly IContent[],
  estimateBlockTokensAsync: (block: ContentBlock) => Promise<number>,
): Promise<RankedToolResponse[]> {
  const positions: Array<{
    entryIndex: number;
    blockIndex: number;
    block: ToolResponseBlock;
  }> = [];

  for (let entryIndex = 0; entryIndex < history.length; entryIndex++) {
    const entry = history[entryIndex];
    for (let blockIndex = 0; blockIndex < entry.blocks.length; blockIndex++) {
      const block = entry.blocks[blockIndex];
      if (block.type === 'tool_response' && !isAlreadyStubbed(block)) {
        positions.push({ entryIndex, blockIndex, block });
      }
    }
  }

  const estimates = await Promise.all(
    positions.map((p) => estimateBlockTokensAsync(p.block)),
  );

  const candidates: RankedToolResponse[] = positions.map((p, i) => ({
    entryIndex: p.entryIndex,
    blockIndex: p.blockIndex,
    block: p.block,
    estimatedTokens: estimates[i],
  }));

  candidates.sort((a, b) => {
    if (b.estimatedTokens !== a.estimatedTokens) {
      return b.estimatedTokens - a.estimatedTokens;
    }
    if (b.entryIndex !== a.entryIndex) {
      return b.entryIndex - a.entryIndex;
    }
    return b.blockIndex - a.blockIndex;
  });

  return candidates;
}

/**
 * Generic synchronous fallback estimator used when no async estimator is
 * available. Exposed so both the pending and provider paths can share the
 * same sound baseline heuristic if they fall back from model-aware
 * tokenization.
 */
export function fallbackEstimateBlockTokens(block: ContentBlock): number {
  return simpleTokenEstimateForText(blockToTokenFallbackString(block));
}

/**
 * Replace oversized tool responses with bounded metadata-only stubs until
 * the projected token count drops under the limit, or candidates are
 * exhausted.
 *
 * After each immutable replacement the baseline is reset and the projection
 * is recomputed, stopping immediately once under the limit. Candidates are
 * ranked using the provided async (model-aware) estimator so that the
 * fattest-first ordering reflects the active model's tokenization.
 */
/**
 * Check the concurrency guard after ranking. If history changed during
 * async estimates, return a safe failure result.
 */
async function checkPostRankingGuard(
  deps: ToolResultTruncatorDeps,
  isHistoryUnchanged: () => boolean,
  ranked: readonly RankedToolResponse[],
): Promise<ToolResponseTruncationResult | undefined> {
  if (isHistoryUnchanged()) {
    return undefined;
  }
  deps.logger.warn(
    () =>
      '[CompressionHandler] History changed during legacy tool-response ranking; aborting truncation to avoid stale-index corruption',
    { rankedCount: ranked.length },
  );
  return {
    replacedCount: 0,
    projected: await deps.computeProjected(),
    success: false,
  };
}

export async function truncateLargestToolResponses(
  deps: ToolResultTruncatorDeps,
  marginAdjustedLimit: number,
): Promise<ToolResponseTruncationResult> {
  const history = deps.historyService.getRawHistory();
  const isHistoryUnchanged = createHistoryGuard(deps.historyService);
  const ranked = await rankToolResponses(
    history,
    deps.estimateBlockTokensAsync,
  );

  const guardResult = await checkPostRankingGuard(
    deps,
    isHistoryUnchanged,
    ranked,
  );
  if (guardResult) {
    return guardResult;
  }

  if (ranked.length === 0) {
    return {
      replacedCount: 0,
      projected: await deps.computeProjected(),
      success: false,
    };
  }

  const model = deps.getRuntimeModel();
  let replacedCount = 0;

  for (const candidate of ranked) {
    if (!isHistoryUnchanged()) {
      deps.logger.warn(
        () =>
          '[CompressionHandler] History changed mid-replacement during legacy tool-response truncation; stopping to avoid stale-index corruption',
        { replacedCount },
      );
      return {
        replacedCount,
        projected: await deps.computeProjected(),
        success: false,
      };
    }

    const stub = createTruncationStub(
      candidate.block,
      candidate.estimatedTokens,
    );
    const replaced = await deps.historyService.replaceToolResponseBlock(
      candidate.entryIndex,
      candidate.blockIndex,
      stub,
      model,
    );
    if (!replaced) {
      continue;
    }
    replacedCount++;

    await deps.historyService.waitForTokenUpdates();
    deps.resetBaseline();
    const projected = await deps.computeProjected();

    deps.logger.debug(
      () =>
        '[CompressionHandler] Truncated oversized tool response during last-resort context enforcement',
      {
        entryIndex: candidate.entryIndex,
        blockIndex: candidate.blockIndex,
        toolName: candidate.block.toolName,
        originalEstimatedTokens: candidate.estimatedTokens,
        projected,
        marginAdjustedLimit,
        replacedCount,
      },
    );

    if (projected <= marginAdjustedLimit) {
      return { replacedCount, projected, success: true };
    }
  }

  return {
    replacedCount,
    projected: await deps.computeProjected(),
    success: false,
  };
}

/**
 * Unified truncation result that includes transformed pending contents.
 */
export interface UnifiedTruncationResult {
  readonly replacedCount: number;
  readonly projected: number;
  readonly success: boolean;
  /**
   * Transformed pending contents with stubs applied to any pending
   * candidates. Undefined when no pending contents were provided.
   */
  readonly transformedPending: IContent[] | undefined;
}

/**
 * Dependencies for the unified pending+history truncation flow.
 */
export interface UnifiedTruncatorDeps {
  readonly historyService: HistoryService;
  readonly logger: DebugLogger;
  /**
   * Pending (new, unsent) contents. Tool-response blocks in these entries
   * are ranked alongside history candidates and, when selected, are
   * immutably replaced in a working copy returned via transformedPending.
   */
  readonly pendingContents: IContent[];
  readonly estimateBlockTokensAsync: (block: ContentBlock) => Promise<number>;
  /**
   * Projection callback that receives the current working copy of pending
   * contents (with any stubs applied so far) so the projection reflects
   * the actual transformed state. The provider path recomposes
   * buildProviderContent(curated, workingPending) and estimates; the
   * pending path projects the pending-token baseline.
   */
  readonly computeProjected: (
    workingPending: readonly IContent[],
  ) => number | Promise<number>;
  readonly resetBaseline: () => void;
  readonly getRuntimeModel: () => string;
}

/**
 * Tagged union that marks where a ranked candidate lives — history or
 * pending — so the replacement strategy can be location-aware.
 */
interface RankedCandidate {
  readonly location: 'history' | 'pending';
  readonly entryIndex: number;
  readonly blockIndex: number;
  readonly block: ToolResponseBlock;
  readonly estimatedTokens: number;
}

/**
 * Snapshot the current history length to detect concurrent mutations
 * (add/clear) during async estimates. Returns a function that checks
 * whether history has changed since the snapshot.
 *
 * This addresses the concurrency/reentrancy concern (issue #1321): if
 * add/clear changes the history array length between ranking and
 * replacement, the entry/block indices become stale and could corrupt
 * history. The returned guard lets callers detect this and abort safely.
 */
function createHistoryGuard(historyService: HistoryService): () => boolean {
  const snapshotLength = historyService.getRawHistory().length;
  return () => historyService.getRawHistory().length === snapshotLength;
}

/**
 * Rank tool-response candidates across both history and pending contents,
 * fattest-first with recency tie-break (later entry/block first).
 *
 * Pending candidates are assigned a synthetic entry index offset by
 * history length so the recency tie-break naturally favors pending
 * (newer) entries over equally-sized history entries.
 */
async function rankAllToolResponses(
  history: readonly IContent[],
  pending: readonly IContent[],
  estimateBlockTokensAsync: (block: ContentBlock) => Promise<number>,
): Promise<RankedCandidate[]> {
  const positions: Array<Omit<RankedCandidate, 'estimatedTokens'>> = [];

  for (let entryIndex = 0; entryIndex < history.length; entryIndex++) {
    const entry = history[entryIndex];
    for (let blockIndex = 0; blockIndex < entry.blocks.length; blockIndex++) {
      const block = entry.blocks[blockIndex];
      if (block.type === 'tool_response' && !isAlreadyStubbed(block)) {
        positions.push({
          location: 'history',
          entryIndex,
          blockIndex,
          block,
        });
      }
    }
  }

  const historyLength = history.length;
  for (let entryIndex = 0; entryIndex < pending.length; entryIndex++) {
    const entry = pending[entryIndex];
    for (let blockIndex = 0; blockIndex < entry.blocks.length; blockIndex++) {
      const block = entry.blocks[blockIndex];
      if (block.type === 'tool_response' && !isAlreadyStubbed(block)) {
        positions.push({
          location: 'pending',
          // Offset by historyLength so the recency tie-break ordering is
          // consistent across both sources.
          entryIndex: historyLength + entryIndex,
          blockIndex,
          block,
        });
      }
    }
  }

  const estimates = await Promise.all(
    positions.map((position) => estimateBlockTokensAsync(position.block)),
  );
  const candidates: RankedCandidate[] = positions.map((position, index) => ({
    ...position,
    estimatedTokens: estimates[index],
  }));

  candidates.sort((a, b) => {
    if (b.estimatedTokens !== a.estimatedTokens) {
      return b.estimatedTokens - a.estimatedTokens;
    }
    if (b.entryIndex !== a.entryIndex) {
      return b.entryIndex - a.entryIndex;
    }
    return b.blockIndex - a.blockIndex;
  });

  return candidates;
}

function clonePendingForResult(
  pending: readonly IContent[],
  workingPending: readonly IContent[],
): IContent[] | undefined {
  if (pending.length === 0) {
    return undefined;
  }
  return workingPending.map((e) => ({ ...e, blocks: [...e.blocks] }));
}

function buildUnifiedFailure(
  projected: number,
  replacedCount: number,
  pending: readonly IContent[],
  workingPending: readonly IContent[],
): UnifiedTruncationResult {
  return {
    replacedCount,
    projected,
    success: false,
    transformedPending: clonePendingForResult(pending, workingPending),
  };
}

function buildUnifiedSuccess(
  projected: number,
  replacedCount: number,
  pending: readonly IContent[],
  workingPending: readonly IContent[],
): UnifiedTruncationResult {
  return {
    replacedCount,
    projected,
    success: true,
    transformedPending: clonePendingForResult(pending, workingPending),
  };
}

/**
 * Immutably replace a pending candidate in the working copy. Returns
 * false if the candidate is out-of-bounds or the target block identity
 * has changed (concurrent mutation), signaling the caller to skip it.
 */
function tryReplacePendingCandidate(
  candidate: RankedCandidate,
  historyLength: number,
  workingPending: IContent[],
  stub: ToolResponseBlock,
): boolean {
  const pendingEntryIndex = candidate.entryIndex - historyLength;
  if (pendingEntryIndex < 0 || pendingEntryIndex >= workingPending.length) {
    return false;
  }
  const entry = workingPending[pendingEntryIndex];
  if (candidate.blockIndex < 0 || candidate.blockIndex >= entry.blocks.length) {
    return false;
  }
  const targetBlock = entry.blocks[candidate.blockIndex];
  if (targetBlock.type !== 'tool_response' || targetBlock !== candidate.block) {
    return false;
  }
  const newBlocks = [...entry.blocks];
  newBlocks[candidate.blockIndex] = stub;
  workingPending[pendingEntryIndex] = { ...entry, blocks: newBlocks };
  return true;
}

interface UnifiedReplacementContext {
  readonly deps: UnifiedTruncatorDeps;
  readonly historyLength: number;
  readonly workingPending: IContent[];
  readonly model: string;
}

/**
 * Apply a single candidate replacement (history or pending). Returns
 * true if the replacement was applied, false if it should be skipped.
 */
async function applyCandidateReplacement(
  ctx: UnifiedReplacementContext,
  candidate: RankedCandidate,
  stub: ToolResponseBlock,
): Promise<boolean> {
  if (candidate.location === 'pending') {
    return tryReplacePendingCandidate(
      candidate,
      ctx.historyLength,
      ctx.workingPending,
      stub,
    );
  }
  const replaced = await ctx.deps.historyService.replaceToolResponseBlock(
    candidate.entryIndex,
    candidate.blockIndex,
    stub,
    ctx.model,
  );
  if (!replaced) {
    return false;
  }
  await ctx.deps.historyService.waitForTokenUpdates();
  return true;
}

function logUnifiedTruncationStep(
  deps: UnifiedTruncatorDeps,
  candidate: RankedCandidate,
  projected: number,
  marginAdjustedLimit: number,
  replacedCount: number,
): void {
  deps.logger.debug(
    () =>
      '[CompressionHandler] Truncated oversized tool response (unified) during last-resort context enforcement',
    {
      location: candidate.location,
      entryIndex: candidate.entryIndex,
      blockIndex: candidate.blockIndex,
      toolName: candidate.block.toolName,
      originalEstimatedTokens: candidate.estimatedTokens,
      projected,
      marginAdjustedLimit,
      replacedCount,
    },
  );
}

/**
 * Outcome of processing a single ranked candidate in the unified loop.
 * - 'skip': candidate was not applied (out-of-bounds or wrong type);
 *   advance to the next candidate.
 * - 'stop': history was concurrently mutated; stop processing all
 *   remaining candidates (indices are stale) and return the best
 *   result so far.
 * - 'success': candidate was applied AND the projected budget is now
 *   under the limit; caller should return immediately.
 * - 'applied': candidate was applied but still over budget; advance to
 *   the next candidate with the updated replacedCount and projected.
 */
type CandidateOutcome =
  | { readonly kind: 'skip' }
  | {
      readonly kind: 'stop';
      readonly projected: number;
    }
  | { readonly kind: 'success'; readonly projected: number }
  | {
      readonly kind: 'applied';
      readonly projected: number;
      readonly replacedCount: number;
    };

/**
 * Process one ranked candidate: check the concurrency guard, apply the
 * stub replacement, re-estimate, and return the outcome. This isolates
 * the per-candidate logic so the main loop body stays small and free of
 * multiple break/continue statements.
 */
async function processUnifiedCandidate(
  ctx: UnifiedReplacementContext,
  candidate: RankedCandidate,
  replacedCountBefore: number,
  marginAdjustedLimit: number,
  isHistoryUnchanged: () => boolean,
): Promise<CandidateOutcome> {
  if (!isHistoryUnchanged()) {
    ctx.deps.logger.warn(
      () =>
        '[CompressionHandler] History changed mid-replacement during unified tool-response truncation; stopping to avoid stale-index corruption',
      { replacedCount: replacedCountBefore },
    );
    return {
      kind: 'stop',
      projected: await ctx.deps.computeProjected(ctx.workingPending),
    };
  }

  const stub = createTruncationStub(candidate.block, candidate.estimatedTokens);

  const applied = await applyCandidateReplacement(ctx, candidate, stub);
  if (!applied) {
    return { kind: 'skip' };
  }

  const replacedCount = replacedCountBefore + 1;
  ctx.deps.resetBaseline();

  const projected = await ctx.deps.computeProjected(ctx.workingPending);
  logUnifiedTruncationStep(
    ctx.deps,
    candidate,
    projected,
    marginAdjustedLimit,
    replacedCount,
  );

  if (projected <= marginAdjustedLimit) {
    return { kind: 'success', projected };
  }
  return { kind: 'applied', projected, replacedCount };
}

/**
 * Location-aware unified truncation: ranks history + pending tool-response
 * candidates together by active-provider tokenizer size (largest first,
 * recent tie-break), immutably replaces pending candidates in a working
 * copy and history candidates via HistoryService.replaceToolResponseBlock,
 * recomposes and re-estimates after every replacement, and returns the
 * transformed pending contents alongside the truncation result.
 *
 * Concurrency safety: a history-length guard detects add/clear mutations
 * during async estimates. If history changes mid-replacement, the function
 * stops processing remaining candidates (indices are stale) and returns
 * the best result so far without deadlocking.
 */
export async function truncateOversizedToolResponsesUnified(
  deps: UnifiedTruncatorDeps,
  marginAdjustedLimit: number,
): Promise<UnifiedTruncationResult> {
  const history = deps.historyService.getRawHistory();
  const pending = deps.pendingContents;
  const model = deps.getRuntimeModel();
  const isHistoryUnchanged = createHistoryGuard(deps.historyService);

  const workingPending: IContent[] = pending.map((entry) => ({
    ...entry,
    blocks: [...entry.blocks],
  }));

  const ranked = await rankAllToolResponses(
    history,
    pending,
    deps.estimateBlockTokensAsync,
  );

  if (!isHistoryUnchanged()) {
    deps.logger.warn(
      () =>
        '[CompressionHandler] History changed during unified tool-response ranking; aborting truncation to avoid stale-index corruption',
      { rankedCount: ranked.length },
    );
    return buildUnifiedFailure(
      await deps.computeProjected(workingPending),
      0,
      pending,
      workingPending,
    );
  }

  if (ranked.length === 0) {
    return buildUnifiedFailure(
      await deps.computeProjected(workingPending),
      0,
      pending,
      workingPending,
    );
  }

  const ctx: UnifiedReplacementContext = {
    deps,
    historyLength: history.length,
    workingPending,
    model,
  };
  let replacedCount = 0;

  for (const candidate of ranked) {
    const outcome = await processUnifiedCandidate(
      ctx,
      candidate,
      replacedCount,
      marginAdjustedLimit,
      isHistoryUnchanged,
    );
    if (outcome.kind === 'success') {
      return buildUnifiedSuccess(
        outcome.projected,
        replacedCount + 1,
        pending,
        workingPending,
      );
    }
    if (outcome.kind === 'stop') {
      return buildUnifiedFailure(
        outcome.projected,
        replacedCount,
        pending,
        workingPending,
      );
    }
    if (outcome.kind === 'applied') {
      replacedCount = outcome.replacedCount;
    }
  }

  return buildUnifiedFailure(
    await deps.computeProjected(workingPending),
    replacedCount,
    pending,
    workingPending,
  );
}
