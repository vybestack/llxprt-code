/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { InheritingDraft } from '../../journal/groupEdits.js';
import type { IdFactQueries } from '../../journal/idFactQueries.js';
import type { JournalStore } from '../../journal/journalStore.js';
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ } from '../../journal/rowEntry.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import { ROW_ID_KIND, ROW_SPEAKER } from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent, ToolCallBlock } from './IContent.js';
import {
  createSyntheticToolMessage,
  hasValidBlocks,
} from './historyToolPairing.js';
import { inheritingDraft } from './journalHistoryEdits.js';
import { decodeStoredRow } from './journalRowCodec.js';

/** A synthetic response and the live row it follows. */
export interface PlannedInsert {
  readonly afterLabel: bigint;
  readonly draft: InheritingDraft;
}

export interface PlannedRepair {
  readonly inserted: IContent[];
  readonly inserts: PlannedInsert[];
}

/**
 * The stamper only needs the marker of a row that has one, to keep its own
 * counters above it. The entry holds that marker, so the row is not read.
 */
function markerOnly(entry: RowEntry): IContent {
  return {
    speaker: 'ai',
    blocks: [],
    metadata: {
      chronology: {
        seq: Number(entry.chronologySeq),
        userTurn: entry.chronologyUserTurn,
        step: entry.chronologyStep,
        recordedAt: entry.chronologyRecordedAt,
      },
    },
  };
}

/** The call ids of an AI row that no response in the history answers, from the row header and the id facts. */
async function unansweredCallIds(
  store: JournalStore,
  facts: IdFactQueries,
  entry: RowEntry,
  repaired: ReadonlySet<string>,
): Promise<Set<string>> {
  const { header, rawIds } = await store.readRowIds(entry);
  const unanswered = new Set<string>();
  for (const [at, tuple] of header.ids.entries()) {
    const id = rawIds[at];
    if (tuple.kind !== ROW_ID_KIND.call || repaired.has(id)) continue;
    if ((await facts.fact(id))?.firstResponse === undefined) unanswered.add(id);
  }
  return unanswered;
}

/** The unanswered tool calls of one AI row; the row is read only when it has some. */
async function missingCalls(
  store: JournalStore,
  facts: IdFactQueries,
  snapshot: VersionSnapshot,
  entry: RowEntry,
  repaired: ReadonlySet<string>,
): Promise<ToolCallBlock[]> {
  const ids = await unansweredCallIds(store, facts, entry, repaired);
  if (ids.size === 0) return [];
  const row = decodeStoredRow(await snapshot.readRow(entry));
  if (!hasValidBlocks(row)) return [];
  return row.blocks.filter(
    (block): block is ToolCallBlock =>
      block.type === 'tool_call' && ids.has(block.id),
  );
}

/**
 * Plans a synthetic response after every AI row whose tool calls have none.
 * A response counts wherever it sits in the history. The id facts answer
 * that without a scan of the bodies; a row is read only when one of its
 * calls is unanswered, and only that row.
 */
export async function planToolPairingRepair(
  store: JournalStore,
  snapshot: VersionSnapshot,
  stamp: (row: IContent) => IContent,
): Promise<PlannedRepair> {
  const repaired = new Set<string>();
  const unanswered: Array<{
    readonly afterLabel: bigint;
    readonly missing: ToolCallBlock[];
  }> = [];
  const facts = await store.idFacts();
  try {
    for await (const entry of snapshot.entries()) {
      if (entry.chronologySeq !== ROW_ENTRY_NO_CHRONOLOGY_SEQ)
        stamp(markerOnly(entry));
      if (entry.speaker !== ROW_SPEAKER.ai) continue;
      const missing = await missingCalls(
        store,
        facts,
        snapshot,
        entry,
        repaired,
      );
      for (const call of missing) repaired.add(call.id);
      if (missing.length > 0)
        unanswered.push({ afterLabel: entry.label, missing });
    }
  } finally {
    facts.close();
  }
  // Every existing marker has been seen by now, so a fresh one cannot collide with a later row.
  const plan: PlannedRepair = { inserted: [], inserts: [] };
  for (const { afterLabel, missing } of unanswered) {
    const synthetic = stamp(createSyntheticToolMessage(missing));
    plan.inserted.push(synthetic);
    plan.inserts.push({ afterLabel, draft: inheritingDraft(synthetic) });
  }
  return plan;
}
