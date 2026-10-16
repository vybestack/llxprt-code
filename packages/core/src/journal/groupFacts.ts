/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { OccurrencePlanner, PlannedRow } from './groupEdits.js';
import { IdFactBatch } from './idFactBatch.js';
import type { IdFactDeps } from './idFactQueries.js';
import type { IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { KeyedMapBatch, type KeyedMapReader } from './keyedMap.js';
import {
  KIMI_EXCEPTION_KEY,
  decodeDecimal,
  encodeDecimal,
  joinParentList,
} from './metaFacts.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowDraft } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds } from './rowReads.js';
import { iterateRowEntries } from './rowTreeReader.js';
import type { ExistingRange, GroupPlan } from './groupPlan.js';

/** The seams the facts of a group need: how keys hash, the planner and the caches that cap every read. */
export interface FactDeps {
  readonly idDeps: IdFactDeps;
  readonly planOccurrences: OccurrencePlanner;
  readonly idCache: IdNodeCache;
}

/** The id facts and meta entries of the rows a group adds, computed from reads only. */
export interface GroupFacts {
  readonly ids: IdFactBatch;
  readonly meta: KeyedMapBatch;
  readonly baseExceptionCount: number;
}

function plannedFromDraft(label: bigint, draft: RowDraft): PlannedRow {
  return { label, speaker: draft.speaker, ids: draft.ids };
}

async function* rangeEntries(
  access: RecordAccess,
  range: ExistingRange,
): AsyncGenerator<RowEntry> {
  const { source, from, to } = range;
  const root = { offset: source.roots.rowRoot, rows: source.rows };
  let taken = 0;
  for await (const entry of iterateRowEntries(access, root, from)) {
    if (taken === to - from) return;
    taken += 1;
    yield entry;
  }
  if (taken !== to - from) {
    throw new JournalFormatError(
      `Row tree ends after ${taken} of the ${to - from} rows to keep`,
    );
  }
}

/** The entries of the existing rows a group keeps, in label order. */
export function existingEntries(
  access: RecordAccess | undefined,
  range: ExistingRange | undefined,
): AsyncGenerator<RowEntry> | undefined {
  if (range === undefined) return undefined;
  if (access === undefined) {
    throw new JournalFormatError('Kept rows need a committed journal to read');
  }
  return rangeEntries(access, range);
}

async function applyRow(
  facts: GroupFacts,
  deps: FactDeps,
  row: PlannedRow,
  parent: { flags: number; parentEndpoint: bigint },
): Promise<void> {
  const occurrences = await deps.planOccurrences(row, facts.ids.queries);
  for (const occurrence of occurrences) await facts.ids.apply(occurrence);
  await joinParentList(facts.meta, {
    label: row.label,
    flags: parent.flags,
    parentEndpoint: parent.parentEndpoint,
  });
}

async function startFacts(
  access: RecordAccess | undefined,
  plan: GroupPlan,
  deps: FactDeps,
  metaReader: KeyedMapReader,
): Promise<GroupFacts> {
  const { idRoot, metaRoot } = plan.base.roots;
  const stored = await metaReader.get(metaRoot, KIMI_EXCEPTION_KEY);
  const baseExceptionCount =
    stored === undefined ? 0 : Number(decodeDecimal(stored));
  const idReader =
    access === undefined ? undefined : new IdTrieReader(access, deps.idCache);
  return {
    ids: new IdFactBatch(
      idRoot === 0 ? undefined : idReader,
      idRoot,
      deps.idDeps,
      baseExceptionCount,
    ),
    meta: new KeyedMapBatch(metaReader, metaRoot),
    baseExceptionCount,
  };
}

/**
 * Applies every row the group adds to the id facts and the meta map, in label
 * order: the kept rows first, read back from their headers and id pieces
 * (design 4.6), then the new rows from their drafts. Only reads happen here,
 * so a failure leaves the file untouched.
 */
export async function collectFacts(
  access: RecordAccess | undefined,
  plan: GroupPlan,
  deps: FactDeps,
  metaReader: KeyedMapReader,
): Promise<GroupFacts> {
  const facts = await startFacts(access, plan, deps, metaReader);
  const kept = existingEntries(access, plan.range);
  if (kept !== undefined && access !== undefined) {
    for await (const entry of kept) {
      const { header, rawIds } = await readRowIds(access, entry);
      const ids = header.ids.map((tuple, index) => ({
        rawId: rawIds[index],
        kind: tuple.kind,
        block: tuple.block,
        score: tuple.score,
        nameLen: tuple.nameLen,
      }));
      await applyRow(
        facts,
        deps,
        { label: header.label, speaker: header.speaker, ids },
        header,
      );
    }
  }
  for (const { label, draft } of plan.newRows) {
    await applyRow(facts, deps, plannedFromDraft(label, draft), draft);
  }
  if (facts.ids.exceptionCount !== facts.baseExceptionCount) {
    facts.meta.set(KIMI_EXCEPTION_KEY, encodeDecimal(facts.ids.exceptionCount));
  }
  return facts;
}
