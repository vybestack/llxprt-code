/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type {
  ToolRank,
  ToolRankingTree,
} from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createTruncationStub,
  isAlreadyStubbed,
} from './toolResultTruncator.js';
import type { OnePassTruncatorDeps } from './toolResponseOnePass.js';
import { selectedToolRank } from './native-tool-selection.js';

interface Publication {
  readonly snapshot: VersionSnapshot;
  readonly tree: ToolRankingTree;
  readonly previous: ToolRank | undefined;
  readonly last: ToolRank;
  readonly firstHistory: number;
  readonly lastParent: number;
  readonly filtered: boolean;
}
async function replaceRow(
  row: IContent,
  label: bigint,
  publication: Publication,
): Promise<{ readonly row: IContent; readonly replaced: number }> {
  const blocks = [...row.blocks];
  let replaced = 0;
  for (const [index, block] of row.blocks.entries()) {
    if (block.type !== 'tool_response' || isAlreadyStubbed(block)) continue;
    const rank = await publication.tree.position(label, index);
    if (
      rank !== undefined &&
      selectedToolRank(rank, undefined, publication.last)
    ) {
      blocks[index] = createTruncationStub(block, rank.score);
      if (selectedToolRank(rank, publication.previous, publication.last))
        replaced++;
    }
  }
  let replacement = { ...row, blocks };
  if (publication.lastParent >= publication.firstHistory)
    [replacement] = invalidateResponsesStatefulChain([replacement]);
  return { row: replacement, replaced };
}
export async function publishNativeToolResponses(
  deps: OnePassTruncatorDeps,
  publication: Publication,
): Promise<number> {
  if (publication.firstHistory === Infinity) return 0;
  let replaced = 0;
  await deps.historyService.detachedValues.transform(
    async (_source, sink) => {
      let ordinal = 0;
      for await (const entry of publication.snapshot.entries()) {
        deps.signal?.throwIfAborted();
        const row = decodeStoredRow(await publication.snapshot.readRow(entry));
        if (row.speaker === 'ai' && row.blocks.length === 0) {
          if (!publication.filtered) ordinal++;
        } else {
          const result = await replaceRow(row, entry.label, publication);
          replaced += result.replaced;
          if (result.replaced > 0)
            await sink.appendReplacement(ordinal, result.row);
          else await sink.appendDerived(ordinal, result.row);
          ordinal++;
        }
      }
    },
    deps.getRuntimeModel(),
    { signal: deps.signal },
  );
  return replaced;
}
export async function stubNativePending(
  working: IContent[],
  overlay: ToolRankingTree,
  rows: number,
  previous: ToolRank | undefined,
  last: ToolRank,
): Promise<number> {
  let replaced = 0;
  for (let at = 0; at < working.length; at++) {
    const row = working[at];
    const blocks = [...row.blocks];
    for (const [index, block] of row.blocks.entries()) {
      if (block.type !== 'tool_response' || isAlreadyStubbed(block)) continue;
      const rank = await overlay.position(BigInt(rows + at + 1), index);
      if (rank === undefined) throw new Error('Missing pending ranking fact');
      if (selectedToolRank(rank, previous, last)) {
        blocks[index] = createTruncationStub(block, rank.score);
        replaced++;
      }
    }
    working[at] = { ...row, blocks };
  }
  return replaced;
}
