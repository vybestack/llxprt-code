/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext, BuiltGroup } from './groupBuildShared.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import { IdFactQueries } from './idFactQueries.js';
import { IdTrieReader } from './idTrieReader.js';
import type { OccurrenceKind } from './idKeys.js';
import type { RowEntry } from './rowEntry.js';
import { rowAlgebra } from './rowAlgebra.js';
import { editRowTree } from './rowTreeEdit.js';
import { entryByLabel } from './rowTreeQueries.js';
import { slotKindsOf } from './version.js';
import type { VersionSnapshot } from './versionSnapshot.js';

interface PairRepair {
  readonly ctx: BuildContext;
  readonly appender: RecordAppender;
  readonly snapshot: VersionSnapshot;
  readonly slot: number;
}

async function invalidate(
  repair: PairRepair,
  built: BuiltGroup,
  label: bigint,
): Promise<BuiltGroup> {
  const { ctx, appender, slot } = repair;
  const access = ctx.readGroup(appender.nextOffset);
  const root = {
    offset: built.state.rowRoot,
    rows: built.state.rootAggregate.rows,
  };
  const entry = await entryByLabel(access, root, label);
  if (entry === undefined)
    throw new JournalFormatError('Indexed Responses pair holder is absent');
  if (entry.stamp[slot].gen === 0) return built;
  const stamp = { gen: 0, imageGen: 0 };
  const updated: RowEntry = {
    ...entry,
    stamp: [
      slot === 0 ? stamp : entry.stamp[0],
      slot === 1 ? stamp : entry.stamp[1],
      slot === 2 ? stamp : entry.stamp[2],
    ],
  };
  const tree = await editRowTree(
    access,
    appender,
    rowAlgebra(slotKindsOf(built.state.slots)),
    root,
    { replace: [updated], insert: [] },
  );
  await appender.drain();
  return {
    ...built,
    spine: undefined,
    state: {
      ...built.state,
      rowRoot: tree.childOffset,
      rootAggregate: tree.aggregate,
    },
  };
}

async function repairId(
  repair: PairRepair,
  built: BuiltGroup,
  before: IdFactQueries,
  id: string,
  kind: OccurrenceKind,
): Promise<BuiltGroup> {
  const after = repair.snapshot.facts;
  const wasPresent = (await before.normalizedCount(1, kind, id)) > 0;
  const present = (await after.normalizedCount(1, kind, id)) > 0;
  if (wasPresent === present) return built;
  const counterpart = kind === 0 ? 1 : 0;
  const count = await after.normalizedCount(1, counterpart, id);
  let next = built;
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const position = await after.normalizedPosition(
      1,
      counterpart,
      id,
      ordinal,
    );
    if (position === undefined)
      throw new JournalFormatError('Counted Responses pair holder is absent');
    next = await invalidate(repair, next, position.label);
  }
  return next;
}

export async function repairResponsesPairChanges(
  repair: PairRepair,
  built: BuiltGroup,
  missing: AsyncIterable<RowEntry>,
): Promise<BuiltGroup> {
  const { ctx, snapshot } = repair;
  if (ctx.published === undefined || ctx.access === undefined) return built;
  const reader = new IdTrieReader(ctx.access, ctx.idCache);
  const root = ctx.published.roots.idRoot;
  const before = new IdFactQueries(
    { get: (hash) => reader.lookup(root, hash) },
    ctx.idDeps,
  );
  let next = built;
  for await (const entry of missing) {
    const ids = await snapshot.readIds(entry);
    for (const rawId of ids.rawIds) {
      const id = snapshot.normalizedId(1, rawId);
      next = await repairId(repair, next, before, id, 0);
      next = await repairId(repair, next, before, id, 1);
    }
  }
  return next;
}
