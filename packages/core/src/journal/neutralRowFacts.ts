/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  readNeutralRowFact,
  writeNeutralRowFact,
} from './neutral-row-fact-storage.js';
import { filledVersion } from './filled-version.js';
import { decodeDecimal, encodeDecimal } from './metaFacts.js';
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import { snapshotOf } from './formatFill.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapBatch, KeyedMapReader } from './keyedMap.js';
import { isDeepStrictEqual } from 'node:util';
import { rootRef } from './groupSegments.js';
import { entryByLabel } from './rowTreeQueries.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';
import type { RowEntry } from './rowEntry.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { Version } from './version.js';
import type { VersionEdit } from './groupEdits.js';

export interface NeutralRowFactRegistration {
  readonly kind: 'token-usage';
  readonly revision: string;
  measure(
    snapshot: VersionSnapshot,
    entry: RowEntry,
    previous: Uint8Array | undefined,
  ): Promise<Uint8Array>;
}

export function neutralRowFactKey(
  registration: Pick<NeutralRowFactRegistration, 'kind' | 'revision'>,
  label: bigint,
): Uint8Array {
  return new TextEncoder().encode(
    `${registration.kind}:${registration.revision}:${label}`,
  );
}

export const NEUTRAL_ROW_FACTS_READY = 'history:neutral-row-facts:1';
export const NEUTRAL_ROW_FACTS_THROUGH = 'history:neutral-row-facts-through:1';

async function* changedEntries(
  ctx: BuildContext,
  appender: RecordAppender,
  offset: number,
  since: number,
  sourceRoot: RowTreeRootRef | undefined,
): AsyncGenerator<RowEntry> {
  if (offset === 0 || offset < since) return;
  const access = ctx.readGroup(appender.nextOffset);
  const node = await readRowTreeNode(access, offset);
  if (node.kind === 'leaf') {
    for (const entry of node.entries) {
      const previous = await entryByLabel(access, sourceRoot, entry.label);
      if (!isDeepStrictEqual(entry, previous)) yield entry;
    }
  } else
    for (const child of node.slots)
      yield* changedEntries(
        ctx,
        appender,
        child.childOffset,
        since,
        sourceRoot,
      );
}

function entriesForFill(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  source: Version | undefined,
  since: number,
): Iterable<RowEntry> | AsyncIterable<RowEntry> {
  if (source === ctx.published && since > 0 && built.changedRows !== undefined)
    return built.changedRows;
  const sourceRoot =
    since > 0 && source !== undefined ? rootRef(source) : undefined;
  return changedEntries(ctx, appender, built.state.rowRoot, since, sourceRoot);
}

async function filledSource(
  ctx: BuildContext,
  through: Uint8Array | undefined,
  edits: readonly VersionEdit[],
): Promise<Version | undefined> {
  if (through === undefined) return undefined;
  const sequence = Number(decodeDecimal(through));
  // Replacement starts a new lineage, so the saved fill is not an ancestor.
  const restored = edits.find(
    (edit) => edit.kind === 'restore' && edit.saved.commitSeq === sequence,
  );
  if (restored?.kind === 'restore') return restored.saved;
  return filledVersion(ctx, sequence);
}

export async function fillNeutralRowFacts(
  ctx: BuildContext,
  built: BuiltGroup,
  appender: RecordAppender,
  edits: readonly VersionEdit[],
): Promise<BuiltGroup> {
  const registration = ctx.neutralRowFacts;
  if (registration === undefined || ctx.deferNeutralRowFacts === true)
    return built;
  await appender.drain();
  const access = ctx.readGroup(appender.nextOffset);
  const metaReader = new KeyedMapReader(
    access,
    ctx.metaCache,
    'meta',
    ctx.hasher,
  );
  const ready = await metaReader.get(
    built.state.metaRoot,
    NEUTRAL_ROW_FACTS_READY,
  );
  const revision = `${registration.kind}:${registration.revision}`;
  const through = await metaReader.get(
    built.state.metaRoot,
    NEUTRAL_ROW_FACTS_THROUGH,
  );
  const source = await filledSource(ctx, through, edits);
  const since =
    new TextDecoder().decode(ready) === revision
      ? (source?.durableEnd ?? 0)
      : 0;
  const batch = new IdFactBatch(
    new IdTrieReader(access, ctx.idCache),
    built.state.idRoot,
    ctx.idDeps,
    0,
    { appender, readGroup: ctx.readGroup },
  );
  const snapshot = snapshotOf(ctx, built, appender);
  try {
    const entries = entriesForFill(ctx, built, appender, source, since);
    for await (const entry of entries) {
      const key = neutralRowFactKey(registration, entry.label);
      const previous = await readNeutralRowFact(batch.queries, key);
      const value = await registration.measure(snapshot, entry, previous);
      await writeNeutralRowFact(batch, key, value);
    }
    const committed = await batch.commit(appender);
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
    meta.set(NEUTRAL_ROW_FACTS_READY, new TextEncoder().encode(revision));
    meta.set(NEUTRAL_ROW_FACTS_THROUGH, encodeDecimal(ctx.commitSeq));
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
