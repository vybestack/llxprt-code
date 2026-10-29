/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  openNativeToolRanking,
  truncateNativeToolResponses,
} from './native-tool-ranking.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  publishSelectedToolResponses,
  withToolResponseRanking,
  type ToolResponseDiskRanking,
} from './toolResponseDiskRanking.js';
import {
  createTruncationStub,
  type UnifiedTruncationResult,
} from './toolResultTruncator.js';

export interface OnePassTruncatorDeps {
  readonly historyService: HistoryService;
  readonly rankingRevision: string;
  readonly logger: DebugLogger;
  readonly signal?: AbortSignal;
  /** Raw pending rows ranked beside history; never mutated. */
  readonly pendingContents: readonly IContent[];
  readonly estimateBlockTokensAsync: (block: ContentBlock) => Promise<number>;
  /** Exact request projection of the durable journal plus the given pending rows. */
  readonly computeProjected: (
    workingPending: readonly IContent[],
  ) => number | Promise<number>;
  readonly getRuntimeModel: () => string;
}

interface Round {
  readonly count: number;
  readonly saving: number;
  readonly fits: boolean;
}

/**
 * Takes candidates fattest first until the running estimate
 * `projected - saving * scale` reaches the limit. The estimate is the sum of
 * each candidate's recorded saving, so no projection is needed per candidate.
 */
function selectRound(
  ranked: ToolResponseDiskRanking,
  projected: number,
  limit: number,
  scale: number,
): Round {
  let count = 0;
  let saving = 0;
  for (
    let pointer = ranked.take();
    pointer !== undefined;
    pointer = ranked.take()
  ) {
    count++;
    saving += pointer.saving;
    if (projected - saving * scale <= limit)
      return { count, saving, fits: true };
  }
  return { count, saving, fits: false };
}

/** Replaces the selected pending candidates in the working copy. */
function stubSelectedPending(
  ranked: ToolResponseDiskRanking,
  working: IContent[],
): number {
  let replaced = 0;
  for (const pointer of ranked.selected()) {
    if (pointer.location !== 'pending') continue;
    const at = pointer.entryIndex - ranked.historyLength;
    const entry = working[at];
    const block = entry.blocks[pointer.blockIndex];
    if (block.type !== 'tool_response')
      throw new Error('Ranked pending tool response target is invalid');
    const blocks = [...entry.blocks];
    blocks[pointer.blockIndex] = createTruncationStub(
      block,
      pointer.estimatedTokens,
    );
    working[at] = { ...entry, blocks };
    replaced++;
  }
  return replaced;
}

function resultOf(
  working: readonly IContent[],
  pendingInput: readonly IContent[],
  replacedCount: number,
  projected: number,
  limit: number,
): UnifiedTruncationResult {
  return {
    replacedCount,
    projected,
    success: projected <= limit,
    transformedPending:
      pendingInput.length === 0
        ? undefined
        : working.map((entry) => ({ ...entry, blocks: [...entry.blocks] })),
  };
}

interface Shedding {
  readonly deps: OnePassTruncatorDeps;
  readonly ranked: ToolResponseDiskRanking;
  readonly working: IContent[];
  readonly limit: number;
}

/**
 * Publishes one round: pending stubs into the working copy, history stubs in a
 * single journal transaction. Returns the number replaced, or undefined when
 * the journal changed under the ranking.
 */
async function publishRound(shedding: Shedding): Promise<number | undefined> {
  const { deps, ranked, working } = shedding;
  const history = await publishSelectedToolResponses(
    deps.historyService,
    ranked,
    createTruncationStub,
    deps.getRuntimeModel(),
    deps.signal,
  );
  if (history === undefined) return undefined;
  const pending = stubSelectedPending(ranked, working);
  ranked.settleSelected();
  await deps.historyService.waitForTokenUpdates();
  return pending + history;
}

/** What one round concluded: the exact projection afterwards and whether to go on. */
interface RoundOutcome {
  readonly replaced: number;
  readonly projected: number;
  readonly scale: number;
}

async function runRound(
  shedding: Shedding,
  projected: number,
  scale: number,
): Promise<RoundOutcome | undefined> {
  const { deps, ranked, working, limit } = shedding;
  const round = selectRound(ranked, projected, limit, scale);
  if (!round.fits) return undefined;
  const replaced = await publishRound(shedding);
  if (replaced === undefined) return undefined;
  const next = await deps.computeProjected(working);
  deps.logger.debug(
    () =>
      '[CompressionHandler] Truncated oversized tool responses in one pass during last-resort context enforcement',
    { replaced, projected: next, limit },
  );
  // A shortfall continues from the exact projection, rescaled by how much of
  // the estimated saving the request really shed.
  const shedTokens = projected - next;
  return {
    replaced,
    projected: next,
    scale:
      round.saving > 0 && shedTokens > 0 ? shedTokens / round.saving : scale,
  };
}

async function shed(shedding: Shedding): Promise<UnifiedTruncationResult> {
  const { deps, ranked, working, limit } = shedding;
  let projected = await deps.computeProjected(working);
  // Even replacing every tool response cannot fit: the weight is elsewhere.
  if (projected - ranked.maximumSaving > limit)
    return resultOf(working, deps.pendingContents, 0, projected, limit);

  let replacedCount = 0;
  let scale = 1;
  while (projected > limit || replacedCount === 0) {
    const outcome = await runRound(shedding, projected, scale);
    if (outcome === undefined) break;
    replacedCount += outcome.replaced;
    projected = outcome.projected;
    scale = outcome.scale;
  }
  return resultOf(
    working,
    deps.pendingContents,
    replacedCount,
    projected,
    limit,
  );
}

/**
 * Last-resort tool-response truncation decided in one pass. Candidates are
 * ranked fattest first, with the saving each stub brings recorded beside its
 * score on disk. Rows are chosen against a running estimate, published in one
 * journal transaction, and the request is projected once to confirm. A
 * confirmation that still exceeds the limit starts another round from the
 * exact projection, so the work stays proportional to the rows rather than to
 * rows times replacements.
 *
 * When replacing every tool response cannot reach the limit, nothing is
 * replaced and the caller fails fast with its context-overflow error.
 */
export async function truncateToolResponsesInOnePass(
  deps: OnePassTruncatorDeps,
  limit: number,
): Promise<UnifiedTruncationResult> {
  const native = await openNativeToolRanking(deps);
  if (native !== undefined)
    return truncateNativeToolResponses(deps, native, limit);
  const working = deps.pendingContents.map((entry) => ({
    ...entry,
    blocks: [...entry.blocks],
  }));
  return withToolResponseRanking(
    deps.historyService,
    working,
    deps.estimateBlockTokensAsync,
    (ranked) => shed({ deps, ranked, working, limit }),
    deps.signal,
    async (block, estimatedTokens) =>
      estimatedTokens -
      (await deps.estimateBlockTokensAsync(
        createTruncationStub(block, estimatedTokens),
      )),
  );
}
