/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from './versionSnapshot.js';
import type { RowEntry } from './rowEntry.js';
import type { VersionEdit } from './groupEdits.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import { mapReader } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { snapshotOf } from './formatFill.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import {
  ToolRankingTreeWriter,
  TOOL_RANKING_READY,
} from './tool-ranking-tree.js';
import { JournalInputError } from './errors.js';
import { ROW_FLAG, ROW_BLOCK_TYPE } from './rowRecord.js';

export interface ToolRankingOverlay {
  readonly measure: (rows: number) => AsyncIterable<{
    readonly ordinal: number;
    readonly block: number;
    readonly score: number;
    readonly saving: number;
  }>;
}
export interface ToolRankingPolicy {
  readonly revision: string;
  readonly measure: (
    snapshot: VersionSnapshot,
    entry: RowEntry,
    block: number,
  ) => Promise<{ readonly score: number; readonly saving: number } | undefined>;
}
export function toolRankingPolicy(
  edits: readonly VersionEdit[],
  previous: ToolRankingPolicy | undefined,
): ToolRankingPolicy | undefined {
  const edit = edits.find((item) => item.kind === 'toolRanking');
  return edit?.kind === 'toolRanking' ? edit.policy : previous;
}
export async function rankingReady(
  ctx: BuildContext,
  revision: string,
): Promise<boolean> {
  const ready = await mapReader(ctx, 'meta').get(
    ctx.published?.roots.metaRoot ?? 0,
    TOOL_RANKING_READY,
  );
  return ready !== undefined && new TextDecoder().decode(ready) === revision;
}
export async function warmToolRanking(
  ctx: BuildContext,
  edits: readonly VersionEdit[],
): Promise<ToolRankingPolicy | undefined> {
  const edit = edits[0];
  if (
    edits.length !== 1 ||
    edit.kind !== 'toolRanking' ||
    edit.overlay !== undefined
  )
    return undefined;
  return (await rankingReady(ctx, edit.policy.revision))
    ? edit.policy
    : undefined;
}
function sourceChange(edit: VersionEdit): boolean {
  return ![
    'toolRanking',
    'factIndex',
    'format',
    'fill',
    'setState',
    'checkpoint',
    'deleteCheckpoint',
    'owner',
  ].includes(edit.kind);
}
async function measureRank(
  policy: ToolRankingPolicy,
  snapshot: VersionSnapshot,
  entry: RowEntry,
  block: number,
): ReturnType<ToolRankingPolicy['measure']> {
  try {
    return await policy.measure(snapshot, entry, block);
  } catch (error) {
    throw new JournalInputError(error);
  }
}
async function* measureOverlay(
  overlay: ToolRankingOverlay,
  rows: number,
): ReturnType<ToolRankingOverlay['measure']> {
  try {
    yield* overlay.measure(rows);
  } catch (error) {
    throw new JournalInputError(error);
  }
}
type RankHeader = Awaited<ReturnType<ToolRankingTreeWriter['header']>>;
async function fillRow(
  tree: ToolRankingTreeWriter,
  snapshot: VersionSnapshot,
  policy: ToolRankingPolicy,
  entry: RowEntry,
  ordinal: number,
  old: RankHeader,
): Promise<RankHeader> {
  let { root, count, saving } = old;
  const ids = await snapshot.readIds(entry);
  for (const [block, item] of ids.header.blocks.entries()) {
    if (item.type !== ROW_BLOCK_TYPE.tool_response) continue;
    const measured = await measureRank(policy, snapshot, entry, block);
    if (measured !== undefined) {
      root = await tree.insert(root, {
        id: ++count,
        label: entry.label,
        ordinal,
        block,
        ...measured,
      });
      saving += Math.max(0, measured.saving);
    }
  }
  return { ...old, root, count, saving };
}
async function fillRows(
  tree: ToolRankingTreeWriter,
  snapshot: VersionSnapshot,
  policy: ToolRankingPolicy,
  old: RankHeader,
): Promise<void> {
  let state = old;
  let ordinal = old.rows;
  for await (const entry of snapshot.entries(old.rows)) {
    if (entry.responseBlocks > 0)
      state = await fillRow(tree, snapshot, policy, entry, ordinal, state);
    if ((entry.flags & ROW_FLAG.responseParent) !== 0)
      state = { ...state, lastParent: ordinal };
    ordinal++;
  }
  await tree.finish(
    state.root,
    state.count,
    snapshot.rows,
    state.saving,
    state.lastParent,
  );
}
async function fillOverlay(
  batch: IdFactBatch,
  rows: number,
  overlay: ToolRankingOverlay,
): Promise<void> {
  const tree = new ToolRankingTreeWriter(batch, true);
  let root = 0;
  let count = 0;
  let saving = 0;
  for await (const rank of measureOverlay(overlay, rows)) {
    root = await tree.insert(root, {
      ...rank,
      label: BigInt(rank.ordinal + 1),
      id: ++count,
    });
    saving += Math.max(0, rank.saving);
  }
  await tree.finish(root, count, 0, saving);
}
async function fillMeasurements(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  policy: ToolRankingPolicy,
  batch: IdFactBatch,
): Promise<void> {
  const edit = edits.find((item) => item.kind === 'toolRanking');
  const tree = new ToolRankingTreeWriter(batch);
  const snapshot = snapshotOf(ctx, built, appender);
  try {
    const incremental =
      (edit !== undefined || edits.every((item) => item.kind === 'append')) &&
      (await rankingReady(ctx, policy.revision));
    const old = incremental
      ? await tree.header()
      : { root: 0, count: 0, rows: 0, saving: 0, lastParent: -1 };
    await fillRows(tree, snapshot, policy, old);
    if (edit?.kind === 'toolRanking' && edit.overlay !== undefined)
      await fillOverlay(batch, snapshot.rows, edit.overlay);
  } finally {
    await snapshot.close();
  }
}
export async function fillToolRanking(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  policy: ToolRankingPolicy | undefined,
): Promise<BuiltGroup> {
  if (!edits.some((edit) => edit.kind === 'toolRanking' || sourceChange(edit)))
    return built;
  await appender.drain();
  const meta = new KeyedMapBatch(
    new KeyedMapReader(
      ctx.readGroup(appender.nextOffset),
      ctx.metaCache,
      'meta',
      ctx.hasher,
    ),
    built.state.metaRoot,
  );
  if (policy === undefined) {
    if (((await meta.get(TOOL_RANKING_READY))?.length ?? 0) === 0) return built;
    meta.set(TOOL_RANKING_READY, new Uint8Array());
    return {
      ...built,
      state: { ...built.state, metaRoot: await meta.commit(appender) },
    };
  }
  const batch = new IdFactBatch(
    new IdTrieReader(ctx.readGroup(appender.nextOffset), ctx.idCache),
    built.state.idRoot,
    ctx.idDeps,
    0,
    { appender, readGroup: ctx.readGroup },
  );
  await fillMeasurements(ctx, built, appender, edits, policy, batch);
  const committed = await batch.commit(appender);
  await appender.drain();
  meta.set(TOOL_RANKING_READY, new TextEncoder().encode(policy.revision));
  return {
    ...built,
    state: {
      ...built.state,
      idRoot: committed.root,
      metaRoot: await meta.commit(appender),
    },
  };
}
