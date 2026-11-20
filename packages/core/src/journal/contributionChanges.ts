/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import type { PlannedRow } from './groupEdits.js';
import { plannedFromDraft } from './groupFacts.js';
import type { GroupPlan, Segment } from './groupPlanTypes.js';
import type { IdFactQueries } from './idFactQueries.js';
import { JournalFormatError } from './errors.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds } from './rowReads.js';
import { entryByLabel } from './rowTreeQueries.js';
import { writeNormalizedRowOccurrences } from './normalizedRowOccurrences.js';
import type { GroupFacts } from './groupFacts.js';
import { rootRef } from './groupSegments.js';
import { plannedFromIds, withUnitContributions } from './unitContributions.js';

export interface ContributionChanges {
  readonly replace: RowEntry[];
  readonly insert: RowEntry[];
}

async function sourceRow(
  ctx: BuildContext,
  entry: RowEntry,
  segment: Segment | undefined,
): Promise<PlannedRow> {
  if (segment?.kind === 'fresh')
    return plannedFromDraft(entry.label, segment.draft);
  if (segment?.kind === 'foreign')
    return plannedFromIds(
      await readRowIds(segment.row.source, segment.row.entry),
    );
  if (ctx.access === undefined)
    throw new JournalFormatError('Contribution row has no source');
  return plannedFromIds(await readRowIds(ctx.access, entry));
}

export async function updateContributions(
  ctx: BuildContext,
  plan: GroupPlan,
  segments: readonly Segment[],
  affected: ReadonlySet<bigint>,
  changes: ContributionChanges,
  facts: IdFactQueries,
  groupFacts?: {
    readonly facts: GroupFacts;
    readonly appender: RecordAppender;
  },
): Promise<void> {
  const changed = new Set(
    [...changes.replace, ...changes.insert].map((entry) => entry.label),
  );
  for (const label of affected) {
    if (changed.has(label) || ctx.access === undefined) continue;
    const entry = await entryByLabel(ctx.access, rootRef(plan.base), label);
    if (entry !== undefined) {
      changes.replace.push(entry);
      changed.add(label);
    }
  }
  const sources = new Map<
    bigint,
    Extract<Segment, { kind: 'fresh' | 'foreign' }>
  >();
  for (const segment of segments) {
    if (segment.kind === 'fresh') sources.set(segment.label, segment);
    if (segment.kind === 'foreign')
      sources.set(segment.row.entry.label, segment);
  }
  for (const list of [changes.replace, changes.insert]) {
    for (let index = 0; index < list.length; index++) {
      const entry = list[index];
      const row = await sourceRow(ctx, entry, sources.get(entry.label));
      const contribution = await withUnitContributions(entry, row, facts);
      list[index] =
        groupFacts === undefined
          ? contribution
          : {
              ...contribution,
              stamp: [
                { gen: 0, imageGen: 0 },
                { gen: 0, imageGen: 0 },
                { gen: 0, imageGen: 0 },
              ],
            };
      if (groupFacts !== undefined) {
        const counters = await writeNormalizedRowOccurrences(
          row,
          list[index],
          groupFacts.facts.ids,
          ctx,
          { appender: groupFacts.appender, readGroup: ctx.readGroup },
          groupFacts.facts,
        );
        list[index] = groupFacts.facts.kimi
          ? { ...list[index], ...counters }
          : list[index];
      }
    }
  }
}
