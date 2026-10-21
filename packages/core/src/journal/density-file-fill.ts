/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from './versionSnapshot.js';
import type { RowEntry } from './rowEntry.js';
import type { VersionEdit } from './groupEdits.js';
import {
  mapReader,
  type BuildContext,
  type BuiltGroup,
} from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { snapshotOf } from './formatFill.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import { NativeFactIndexWriter, nativeFactVersion } from './nativeFactIndex.js';
import { JournalInputError } from './errors.js';
import {
  DENSITY_FILES_READY,
  DENSITY_FILES_SCOPE,
  DensityFileFacts,
  observeDensityFile,
  type DensityFilePolicy,
} from './density-file-facts.js';

export function densityFilePolicy(
  edits: readonly VersionEdit[],
  previous: DensityFilePolicy | undefined,
): DensityFilePolicy | undefined {
  const edit = edits.find((item) => item.kind === 'densityFiles');
  return edit?.kind === 'densityFiles' ? edit.policy : previous;
}
async function ready(ctx: BuildContext, revision: string): Promise<boolean> {
  const bytes = await mapReader(ctx, 'meta').get(
    ctx.published?.roots.metaRoot ?? 0,
    DENSITY_FILES_READY,
  );
  return bytes !== undefined && new TextDecoder().decode(bytes) === revision;
}
export async function warmDensityFiles(
  ctx: BuildContext,
  edits: readonly VersionEdit[],
): Promise<DensityFilePolicy | undefined> {
  const edit = edits[0];
  return edits.length === 1 &&
    edit.kind === 'densityFiles' &&
    (await ready(ctx, edit.policy.revision))
    ? edit.policy
    : undefined;
}
function sourceChange(edit: VersionEdit): boolean {
  return ![
    'densityFiles',
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
async function* inputOccurrences(
  policy: DensityFilePolicy,
  snapshot: VersionSnapshot,
  entry: RowEntry,
): ReturnType<DensityFilePolicy['occurrences']> {
  try {
    yield* policy.occurrences(snapshot, entry);
  } catch (error) {
    throw new JournalInputError(error);
  }
}
export async function fillDensityFiles(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
  policy: DensityFilePolicy | undefined,
): Promise<BuiltGroup> {
  if (!edits.some((edit) => edit.kind === 'densityFiles' || sourceChange(edit)))
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
    if (((await meta.get(DENSITY_FILES_READY))?.length ?? 0) === 0)
      return built;
    meta.set(DENSITY_FILES_READY, new Uint8Array());
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
  const writer = new NativeFactIndexWriter(batch, DENSITY_FILES_SCOPE);
  const incremental =
    edits.every((edit) => edit.kind === 'append' || !sourceChange(edit)) &&
    (await ready(ctx, policy.revision));
  const old = incremental
    ? await new DensityFileFacts(writer).header()
    : undefined;
  const generation =
    old === undefined ? nativeFactVersion(ctx.commitSeq) : [old[0], old[1]];
  const snapshot = snapshotOf(ctx, built, appender);
  let ordinal = old?.[2] ?? 0;
  let duplicates = old?.[3] ?? 0;
  try {
    for await (const entry of snapshot.entries(ordinal)) {
      for await (const occurrence of inputOccurrences(
        policy,
        snapshot,
        entry,
      )) {
        duplicates += Number(
          await observeDensityFile(writer, generation, occurrence, ordinal),
        );
      }
      ordinal++;
    }
    await writer.set(['head'], [...generation, snapshot.rows, duplicates]);
  } finally {
    await snapshot.close();
  }
  const committed = await batch.commit(appender);
  await appender.drain();
  meta.set(DENSITY_FILES_READY, new TextEncoder().encode(policy.revision));
  return {
    ...built,
    state: {
      ...built.state,
      idRoot: committed.root,
      metaRoot: await meta.commit(appender),
    },
  };
}
