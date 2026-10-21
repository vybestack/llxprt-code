/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import {
  ToolRankingTree,
  rankBefore,
  type ToolRank,
} from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';
import {
  decodeStoredBlock,
  decodeStoredRow,
} from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_SPEAKER,
} from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import { historyMutationFailure } from '@vybestack/llxprt-code-core/services/history/historyMutationEffects.js';
import type { OnePassTruncatorDeps } from './toolResponseOnePass.js';
import {
  createTruncationStub,
  isAlreadyStubbed,
  type UnifiedTruncationResult,
} from './toolResultTruncator.js';

export async function openNativeToolRanking(
  deps: OnePassTruncatorDeps,
): Promise<VersionSnapshot | undefined> {
  const { estimateBlockTokensAsync } = deps;
  deps.signal?.throwIfAborted();
  return deps.historyService.openToolResponseRanking({
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
  });
}

function selected(
  rank: ToolRank,
  previous: ToolRank | undefined,
  last: ToolRank,
): boolean {
  return (
    !rankBefore(last, rank) &&
    (previous === undefined || rankBefore(previous, rank))
  );
}

async function publish(
  deps: OnePassTruncatorDeps,
  snapshot: VersionSnapshot,
  tree: ToolRankingTree,
  previous: ToolRank | undefined,
  last: ToolRank,
): Promise<number> {
  let first = Infinity;
  let lastParent = -1;
  let probeOrdinal = 0;
  for await (const entry of snapshot.entries()) {
    const ordinal = probeOrdinal++;
    if (
      entry.speaker === ROW_SPEAKER.ai &&
      (entry.flags & ROW_FLAG.responseParent) !== 0
    )
      lastParent = ordinal;
    if (entry.responseBlocks === 0) continue;
    const row = await snapshot.readIds(entry);
    for (const [block, value] of row.header.blocks.entries()) {
      if (value.type !== ROW_BLOCK_TYPE.tool_response) continue;
      const rank = await tree.position(entry.label, block);
      if (rank !== undefined && selected(rank, previous, last))
        first = Math.min(first, ordinal);
    }
  }
  if (first === Infinity) return 0;
  let replaced = 0;
  await deps.historyService.detachedValues.transform(
    async (_source, sink) => {
      let ordinal = 0;
      for await (const entry of snapshot.entries()) {
        deps.signal?.throwIfAborted();
        let row = decodeStoredRow(await snapshot.readRow(entry));
        if (row.speaker === 'ai' && row.blocks.length === 0) {
          if (previous === undefined) ordinal++;
          continue;
        }
        const blocks = [...row.blocks];
        let changed = false;
        for (const [index, block] of row.blocks.entries()) {
          if (block.type !== 'tool_response' || isAlreadyStubbed(block))
            continue;
          const rank = await tree.position(entry.label, index);
          if (rank !== undefined && selected(rank, undefined, last)) {
            blocks[index] = createTruncationStub(block, rank.score);
            if (selected(rank, previous, last)) replaced++;
            changed = true;
          }
        }
        if (changed) row = { ...row, blocks };
        if (lastParent >= first)
          [row] = invalidateResponsesStatefulChain([row]);
        if (changed) await sink.appendReplacement(ordinal, row);
        else await sink.appendDerived(ordinal, row);
        ordinal++;
      }
    },
    deps.getRuntimeModel(),
    { signal: deps.signal },
  );
  return replaced;
}

export async function truncateNativeToolResponses(
  deps: OnePassTruncatorDeps,
  snapshot: VersionSnapshot,
  limit: number,
): Promise<UnifiedTruncationResult> {
  let failure: { error: unknown } | undefined;
  let result: UnifiedTruncationResult | undefined;
  try {
    result = await shed(deps, snapshot, limit);
  } catch (error) {
    failure = { error };
  }
  const cleanup: unknown[] = [];
  try {
    await snapshot.close();
  } catch (error) {
    cleanup.push(error);
  }
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, cleanup);
  if (cleanup.length === 1) throw cleanup[0];
  if (result === undefined)
    throw new Error('Native tool ranking produced no result');
  return result;
}

async function shed(
  deps: OnePassTruncatorDeps,
  snapshot: VersionSnapshot,
  limit: number,
): Promise<UnifiedTruncationResult> {
  const tree = await snapshot.toolRanking(deps.rankingRevision);
  const header = await tree.header();
  const working = deps.pendingContents.map((row) => ({
    ...row,
    blocks: [...row.blocks],
  }));
  let projected = await deps.computeProjected(working);
  let replacedCount = 0;
  let maximum = header.saving;
  for await (const rank of pending(deps, working, snapshot.rows))
    maximum += Math.max(0, rank.saving);
  let previous: ToolRank | undefined;
  let scale = 1;
  const cursor = tree.ordered(header.root)[Symbol.asyncIterator]();
  let durable = await cursor.next();
  try {
    while (
      (projected > limit || replacedCount === 0) &&
      projected - maximum <= limit
    ) {
      let saving = 0;
      let last: ToolRank | undefined;
      while (true) {
        let nextPending: ToolRank | undefined;
        for await (const rank of pending(deps, working, snapshot.rows)) {
          const after = last ?? previous;
          if (after !== undefined && !rankBefore(after, rank)) continue;
          if (nextPending === undefined || rankBefore(rank, nextPending))
            nextPending = rank;
        }
        const fromHistory =
          durable.done !== true &&
          (nextPending === undefined || rankBefore(durable.value, nextPending));
        if (fromHistory && durable.done !== true) {
          last = durable.value;
          durable = await cursor.next();
        } else if (nextPending !== undefined) last = nextPending;
        else break;
        saving += last.saving;
        if (projected - saving * scale <= limit) break;
      }
      if (last === undefined || projected - saving * scale > limit) break;
      let replaced = await publish(deps, snapshot, tree, previous, last);
      for (let at = 0; at < working.length; at++) {
        const row = working[at];
        const blocks = [...row.blocks];
        for (const [index, block] of row.blocks.entries()) {
          if (block.type !== 'tool_response' || isAlreadyStubbed(block))
            continue;
          const score = await deps.estimateBlockTokensAsync(block);
          const rank = {
            id: 0,
            label: 0n,
            ordinal: snapshot.rows + at,
            block: index,
            score,
            saving: 0,
          };
          if (selected(rank, previous, last)) {
            blocks[index] = createTruncationStub(block, score);
            replaced++;
          }
        }
        working[at] = { ...row, blocks };
      }
      await deps.historyService.waitForTokenUpdates();
      const next = await deps.computeProjected(working);
      const shedTokens = projected - next;
      scale = saving > 0 && shedTokens > 0 ? shedTokens / saving : scale;
      projected = next;
      replacedCount += replaced;
      previous = last;
      maximum = Infinity;
    }
  } finally {
    await cursor.return();
  }
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
