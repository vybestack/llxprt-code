/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import {
  plannedFromIds,
  unitCount,
  withUnitContributions,
} from '../../journal/unitContributions.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { journalEntryPlans } from './journal-entry-plans.js';
import type { JournalTailSource } from './journal-tail-source.js';

export interface IndexedOverlayRow {
  readonly entry: RowEntry;
  readonly start: number;
  readonly count: number;
  readonly oldCount: number;
  readonly pendingMask: number;
}

async function overlayRow(
  source: JournalTailSource,
  entry: RowEntry,
  start: number,
  oldCount: number,
): Promise<IndexedOverlayRow> {
  const updated = await withUnitContributions(
    entry,
    plannedFromIds(await source.readIds(entry)),
    source.facts,
  );
  const count = unitCount(updated);
  let emitted = 0;
  let pendingMask = 0;
  for await (const plan of journalEntryPlans(source, entry)) {
    if (plan.pending) pendingMask |= 1 << emitted;
    emitted++;
  }
  if (emitted !== count)
    throw new JournalFormatError(
      `Indexed overlay contribution ${count} disagrees with ${emitted} plans`,
    );
  return { entry: updated, start, count, oldCount, pendingMask };
}

export async function indexedOverlay(
  snapshot: VersionSnapshot,
  source: JournalTailSource,
): Promise<{
  readonly rows: readonly IndexedOverlayRow[];
  readonly count: number;
  readonly firstOutputIndex: number | undefined;
}> {
  const rows: IndexedOverlayRow[] = [];
  let delta = 0;
  for (const label of await source.affectedJournalLabels()) {
    const entry = await snapshot.entryByLabel(label);
    if (entry === undefined)
      throw new JournalFormatError(
        'Tail target is absent from the pinned tree',
      );
    const projected = await source.entryByLabel(label);
    if (projected === undefined)
      throw new JournalFormatError('Projected request row is absent');
    const row = await overlayRow(
      source,
      projected,
      (await snapshot.unitsBelow(label)) + delta,
      unitCount(entry),
    );
    rows.push(row);
    delta += row.count - row.oldCount;
  }
  let count = snapshot.units + delta;
  for (const entry of source.tailEntries()) {
    const row = await overlayRow(source, entry, count, 0);
    rows.push(row);
    count += row.count;
  }
  const first = rows.find((row) => row.pendingMask !== 0);
  const firstOutputIndex =
    first === undefined
      ? undefined
      : first.start + Math.log2(first.pendingMask & -first.pendingMask);
  return { rows, count, firstOutputIndex };
}
