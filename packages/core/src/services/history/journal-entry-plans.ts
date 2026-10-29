/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowEntry } from '../../journal/rowEntry.js';
import { completedResponseParts } from './journal-reconstruction.js';
import { selfResponsePlan } from './journal-self-plan.js';
import { responseAdjacent } from './journal-response-slots.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import type { JournalRequestBase } from './journal-request-projection.js';

export async function* journalEntryPlans(
  source: JournalRequestBase,
  entry: RowEntry,
  nextEntry?: RowEntry | null,
): AsyncGenerator<JournalResponsePlan> {
  async function* entries(): AsyncGenerator<RowEntry> {
    yield entry;
    if (entry.toolCallBlocks === 0) return;
    const next =
      nextEntry === undefined
        ? await source.nextCuratedAfter(entry.label)
        : nextEntry;
    if (next !== undefined && next !== null) yield next;
  }
  const parts = completedResponseParts(source, entries());
  try {
    let current = await parts.next();
    while (current.done !== true && current.value.entry.label === entry.label) {
      const part = current.value;
      const self = await selfResponsePlan(source, part);
      if (self !== undefined) yield self;
      const next = await parts.next();
      const adjacent = await responseAdjacent(
        source,
        part,
        next.done === true ? undefined : next.value,
      );
      if (adjacent !== undefined) yield adjacent;
      current = next;
    }
  } finally {
    await parts.return(undefined);
  }
}
