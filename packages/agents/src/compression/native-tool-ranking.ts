/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import {
  ToolRankingTree,
  type ToolRank,
} from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';
import { decodeStoredBlock } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ROW_BLOCK_TYPE } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import { historyMutationFailure } from '@vybestack/llxprt-code-core/services/history/historyMutationEffects.js';
import type { OnePassTruncatorDeps } from './toolResponseOnePass.js';
import {
  createTruncationStub,
  isAlreadyStubbed,
  type UnifiedTruncationResult,
} from './toolResultTruncator.js';
import { NativeToolSelection } from './native-tool-selection.js';
import {
  publishNativeToolResponses,
  stubNativePending,
} from './native-tool-publication.js';

export async function openNativeToolRanking(
  deps: OnePassTruncatorDeps,
): Promise<VersionSnapshot | undefined> {
  const { estimateBlockTokensAsync } = deps;
  deps.signal?.throwIfAborted();
  return deps.historyService.openToolResponseRanking(
    {
      revision: deps.rankingRevision,
      measure: async (snapshot, entry, blockIndex) => {
        const block = decodeStoredBlock(
          await snapshot.readBlock(entry, blockIndex),
          ROW_BLOCK_TYPE.tool_response,
        );
        if (block.type !== 'tool_response')
          throw new Error('Invalid ranked response block');
        if (isAlreadyStubbed(block)) return undefined;
        const score = await estimateBlockTokensAsync(block);
        const saving =
          score -
          (await estimateBlockTokensAsync(createTruncationStub(block, score)));
        return { score, saving };
      },
    },
    deps.pendingContents.length === 0
      ? undefined
      : { measure: (rows) => pending(deps, deps.pendingContents, rows) },
  );
}
export async function truncateNativeToolResponses(
  deps: OnePassTruncatorDeps,
  snapshot: VersionSnapshot,
  limit: number,
): Promise<UnifiedTruncationResult> {
  let outcome:
    | { readonly result: UnifiedTruncationResult }
    | { readonly failure: unknown };
  try {
    outcome = { result: await shed(deps, snapshot, limit) };
  } catch (error) {
    outcome = { failure: error };
  }
  const cleanup: unknown[] = [];
  try {
    await snapshot.close();
  } catch (error) {
    cleanup.push(error);
  }
  if ('failure' in outcome)
    throw historyMutationFailure(outcome.failure, cleanup);
  if (cleanup.length > 0) throw cleanup[0];
  return outcome.result;
}
async function shed(
  deps: OnePassTruncatorDeps,
  snapshot: VersionSnapshot,
  limit: number,
): Promise<UnifiedTruncationResult> {
  let current = deps.historyService.historyMutationGuard();
  const tree = await snapshot.toolRanking(deps.rankingRevision);
  const header = await tree.header();
  const overlay = new ToolRankingTree(snapshot.facts, true);
  const pendingHeader =
    deps.pendingContents.length === 0
      ? { root: 0, saving: 0 }
      : await overlay.header();
  const working = deps.pendingContents.map((row) => ({
    ...row,
    blocks: [...row.blocks],
  }));
  let projected = await deps.computeProjected(working);
  let replacedCount = 0;
  let previous: ToolRank | undefined;
  let scale = 1;
  let filtered = false;
  let firstHistory = Infinity;
  const maximum = header.saving + pendingHeader.saving;
  const selection = new NativeToolSelection(
    tree.ordered(header.root),
    overlay.ordered(pendingHeader.root),
    snapshot.rows,
  );
  await selection.run(async () => {
    let running = projected - maximum <= limit;
    while (running && (projected > limit || replacedCount === 0)) {
      deps.signal?.throwIfAborted();
      const round = await selection.round(projected, limit, scale);
      running = round !== undefined && current();
      if (round !== undefined && running) {
        firstHistory = Math.min(firstHistory, round.firstHistory);
        const history = await publishNativeToolResponses(deps, {
          snapshot,
          tree,
          previous,
          last: round.last,
          firstHistory,
          lastParent: header.lastParent,
          filtered,
          replacement: 'density',
        });
        filtered ||= history > 0;
        current = deps.historyService.historyMutationGuard();
        const pendingCount = await stubNativePending(
          working,
          overlay,
          snapshot.rows,
          previous,
          round.last,
        );
        await deps.historyService.waitForTokenUpdates();
        const next = await deps.computeProjected(working);
        const shedTokens = projected - next;
        scale =
          round.saving > 0 && shedTokens > 0
            ? shedTokens / round.saving
            : scale;
        projected = next;
        replacedCount += history + pendingCount;
        previous = round.last;
      }
    }
  });
  return {
    replacedCount,
    projected,
    success: projected <= limit,
    transformedPending: deps.pendingContents.length === 0 ? undefined : working,
  };
}
async function* pending(
  deps: OnePassTruncatorDeps,
  working: readonly IContent[],
  rows: number,
): AsyncGenerator<ToolRank> {
  for (const [ordinal, row] of working.entries()) {
    for (const [blockIndex, block] of row.blocks.entries()) {
      if (block.type !== 'tool_response' || isAlreadyStubbed(block)) continue;
      const score = await deps.estimateBlockTokensAsync(block);
      yield {
        id: 0,
        label: 0n,
        ordinal: rows + ordinal,
        block: blockIndex,
        score,
        saving:
          score -
          (await deps.estimateBlockTokensAsync(
            createTruncationStub(block, score),
          )),
      };
    }
  }
}
