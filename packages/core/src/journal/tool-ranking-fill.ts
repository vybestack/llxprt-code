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

export interface ToolRankingPolicy {
  readonly revision: string;
  readonly measure: (
    snapshot: VersionSnapshot,
    entry: RowEntry,
    block: number,
  ) => Promise<{ readonly score: number; readonly saving: number } | undefined>;
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

export async function fillToolRanking(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  policy: ToolRankingPolicy | undefined,
): Promise<BuiltGroup> {
  const explicit = edits.some((edit) => edit.kind === 'toolRanking');
  const changed = edits.some(sourceChange);
  if (!explicit && !changed) return built;
  await appender.drain();
  const read = (): ReturnType<BuildContext['readGroup']> =>
    ctx.readGroup(appender.nextOffset);
  const meta = new KeyedMapBatch(
    new KeyedMapReader(read(), ctx.metaCache, 'meta', ctx.hasher),
    built.state.metaRoot,
  );
  if (policy === undefined) {
    meta.set(TOOL_RANKING_READY, new Uint8Array());
    return {
      ...built,
      state: { ...built.state, metaRoot: await meta.commit(appender) },
    };
  }
  const batch = new IdFactBatch(
    new IdTrieReader(read(), ctx.idCache),
    built.state.idRoot,
    ctx.idDeps,
    0,
    { appender, readGroup: ctx.readGroup },
  );
  const tree = new ToolRankingTreeWriter(batch);
  const snapshot = snapshotOf(ctx, built, appender);
  try {
    const incremental =
      !explicit &&
      edits.every((edit) => edit.kind === 'append') &&
      (await rankingReady(ctx, policy.revision));
    const old = incremental
      ? await tree.header()
      : { root: 0, count: 0, rows: 0, saving: 0 };
    let { root, count, saving } = old;
    let ordinal = old.rows;
    for await (const entry of snapshot.entries(old.rows)) {
      if (entry.responseBlocks > 0) {
        const ids = await snapshot.readIds(entry);
        for (let block = 0; block < ids.header.blocks.length; block++) {
          if (ids.header.blocks[block].type !== 2) continue;
          let measured: Awaited<ReturnType<ToolRankingPolicy['measure']>>;
          try {
            measured = await policy.measure(snapshot, entry, block);
          } catch (error) {
            throw new JournalInputError(error);
          }
          if (measured === undefined) continue;
          root = await tree.insert(root, {
            id: ++count,
            label: entry.label,
            ordinal,
            block,
            ...measured,
          });
          if (measured.saving > 0) saving += measured.saving;
        }
      }
      ordinal++;
    }
    await tree.finish(root, count, snapshot.rows, saving);
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
  } finally {
    await snapshot.close();
  }
}
