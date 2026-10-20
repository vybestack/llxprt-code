/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowEntry } from '../../journal/rowEntry.js';
import { completedResponseParts } from './journal-reconstruction.js';
import { selfResponsePlan } from './journal-self-plan.js';
import { responseAdjacent } from './journal-response-slots.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import type { JournalTailSource } from './journal-tail-source.js';

export async function* journalEntryPlans(
  source: JournalTailSource,
  entry: RowEntry,
): AsyncGenerator<JournalResponsePlan> {
  async function* entries(): AsyncGenerator<RowEntry> {
    yield entry;
    const next = await source.nextCuratedAfter(entry.label);
    if (next !== undefined) yield next;
  }
  const parts = completedResponseParts(source, entries());
  try {
    let current = await parts.next();
    while (current.done !== true && current.value.entry.label === entry.label) {
      const part = current.value;
      const next = await parts.next();
      const self = await selfResponsePlan(source, part);
      if (self !== undefined) yield self;
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
