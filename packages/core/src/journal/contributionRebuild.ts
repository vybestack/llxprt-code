/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import type { GroupFacts } from './groupFacts.js';
import { writeNormalizedRowOccurrences } from './normalizedRowOccurrences.js';
import { readRowIds } from './rowReads.js';
import type { RowEntry } from './rowEntry.js';
import { bulkBuildRowTree, type RowTreeAlgebra } from './rowTreeBuilder.js';
import { iterateRowEntries, type RowTreeRootRef } from './rowTreeReader.js';
import { plannedFromIds, withUnitContributions } from './unitContributions.js';

export async function rebuildContributions(
  ctx: BuildContext,
  appender: RecordAppender,
  algebra: RowTreeAlgebra,
  root: RowTreeRootRef,
  facts: GroupFacts,
): ReturnType<typeof bulkBuildRowTree> {
  await appender.drain();
  const access = ctx.readGroup(appender.nextOffset);
  async function* entries(): AsyncGenerator<RowEntry> {
    for await (const entry of iterateRowEntries(access, root)) {
      const row = plannedFromIds(await readRowIds(access, entry));
      const updated = await withUnitContributions(
        entry,
        row,
        facts.ids.queries,
      );
      const counters = await writeNormalizedRowOccurrences(
        row,
        updated,
        facts.ids,
        ctx,
        { appender, readGroup: ctx.readGroup },
        facts,
      );
      yield {
        ...updated,
        ...(facts.kimi ? counters : {}),
        stamp: [
          { gen: 0, imageGen: 0 },
          { gen: 0, imageGen: 0 },
          { gen: 0, imageGen: 0 },
        ],
      };
    }
  }
  return bulkBuildRowTree(appender, algebra, entries());
}
