/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BuildContext } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import type { GroupFacts } from './groupFacts.js';
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
      yield await withUnitContributions(
        entry,
        plannedFromIds(await readRowIds(access, entry)),
        facts.ids.queries,
      );
    }
  }
  return bulkBuildRowTree(appender, algebra, entries());
}
