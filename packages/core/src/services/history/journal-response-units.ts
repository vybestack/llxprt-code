/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { IContent } from './IContent.js';
import { countDecodedRow } from './journalRowCounters.js';
import type { JournalResponseSource } from './journal-response-source.js';
import { responseAdjacent } from './journal-response-slots.js';
import { completedResponseParts } from './journal-reconstruction.js';
import { JournalTailSource } from './journal-tail-source.js';
import { selfResponsePlan } from './journal-self-plan.js';
import type { JournalResponsePlan } from './journal-response-plan.js';

export interface JournalResponseUnitRecord {
  readonly content: IContent;
  readonly pending: boolean;
}

export async function* streamJournalResponsePlans(
  snapshot: VersionSnapshot,
  tail: readonly IContent[] = [],
): AsyncGenerator<JournalResponsePlan> {
  const release = snapshot.hold();
  try {
    yield* streamResponsePlans(await JournalTailSource.create(snapshot, tail));
  } finally {
    await release();
  }
}

export async function* streamResponsePlans(
  source: JournalResponseSource,
): AsyncGenerator<JournalResponsePlan> {
  const parts = completedResponseParts(source);
  try {
    let current = await parts.next();
    while (current.done !== true) {
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

async function* chargedUnit(
  plan: JournalResponsePlan,
  counters: JournalReadCounters | undefined,
): AsyncGenerator<JournalResponseUnitRecord> {
  const blocks: IContent['blocks'] = [];
  for await (const block of plan.openBlocks()) blocks.push(block);
  const content = { ...plan.header, blocks };
  const release = countDecodedRow(content, counters);
  try {
    yield { content, pending: plan.pending };
  } finally {
    release();
  }
}

export async function* streamJournalResponseUnitRecords(
  snapshot: VersionSnapshot,
  tail: readonly IContent[] = [],
  counters?: JournalReadCounters,
): AsyncGenerator<JournalResponseUnitRecord> {
  for await (const plan of streamJournalResponsePlans(snapshot, tail))
    yield* chargedUnit(plan, counters);
}

export async function* streamJournalResponseUnits(
  snapshot: VersionSnapshot,
  tail: readonly IContent[] = [],
  counters?: JournalReadCounters,
): AsyncGenerator<IContent> {
  for await (const unit of streamJournalResponseUnitRecords(
    snapshot,
    tail,
    counters,
  ))
    yield unit.content;
}
