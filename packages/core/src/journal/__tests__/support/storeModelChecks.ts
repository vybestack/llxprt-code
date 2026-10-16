/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ownerBloomBit } from '../../ownerRules.js';
import { expect } from 'bun:test';
import type { IdOccurrence } from '../../idFactUpdate.js';
import {
  ID_NS,
  OCCURRENCE_KIND,
  sha256KeyHash,
  type NormalizedFamily,
  type OccurrenceKind,
} from '../../idKeys.js';
import type { JournalStore } from '../../journalStore.js';
import {
  decodeDecimal,
  parentCountKey,
  parentListKey,
} from '../../metaFacts.js';
import type { RowEntry } from '../../rowEntry.js';
import { ROW_FLAG, ROW_ID_KIND } from '../../rowRecord.js';
import { slotKindsOf } from '../../version.js';
import { normalizeFor } from './idFactFixture.js';
import { ID_SHAPES, listKey, naiveState } from './idHistoryModel.js';
import { hex } from './idTrieHarness.js';
import { naiveAggregate } from './rowTreeFixtures.js';
import type { ModelRow, StoreModel } from './storeModel.js';

const FAMILIES = [ID_NS.openai, ID_NS.anthropic] as const;
const KINDS = [OCCURRENCE_KIND.call, OCCURRENCE_KIND.response] as const;
const ENDPOINTS = [0n, 7n] as const;

/** The occurrences the test planner (`plainPlanner`) gives these rows: every id at its own row, part 0 and unit 0. */
export function occurrencesOfModel(rows: readonly ModelRow[]): IdOccurrence[] {
  return rows.flatMap((row) =>
    row.ids.map((id, index) => ({
      rawId: id.rawId,
      kind:
        id.kind === ROW_ID_KIND.call
          ? OCCURRENCE_KIND.call
          : OCCURRENCE_KIND.response,
      at: { label: row.label, part: 0, block: 1 + index },
      partSpeaker: row.speaker,
      unit: {
        position: { label: row.label, part: 0, unit: 0 },
        speaker: row.speaker,
        leadingTool: false,
      },
      score: id.score,
      nameLen: id.nameLen,
      reconstructed: false,
    })),
  );
}

async function entriesOf(store: JournalStore): Promise<RowEntry[]> {
  const entries: RowEntry[] = [];
  for await (const entry of store.rows()) entries.push(entry);
  return entries;
}

async function expectRowsMatch(
  store: JournalStore,
  model: StoreModel,
  entries: readonly RowEntry[],
): Promise<void> {
  expect(entries.map((entry) => entry.label)).toStrictEqual(
    model.rows.map((row) => row.label),
  );
  for (const [index, row] of model.rows.entries()) {
    const entry = entries[index];
    expect({
      label: entry.label,
      owner: entry.owner,
      speaker: entry.speaker,
      flags: entry.flags,
      seq: entry.chronologySeq,
      tokens: entry.tokens,
      media: entry.media,
      lensRef: entry.lensRef,
    }).toStrictEqual({
      label: row.label,
      owner: row.owner,
      speaker: row.speaker,
      flags: model.entryFlags(row),
      seq: row.seq,
      tokens: row.tokens,
      media: row.media,
      lensRef: row.lensRef,
    });
    const stored = await store.readRow(entry);
    expect(stored.header.label).toBe(row.label);
    expect(stored.header.speaker).toBe(row.speaker);
    expect(stored.rawIds).toStrictEqual(row.ids.map((id) => id.rawId));
    expect(new TextDecoder().decode(stored.blocks[0])).toBe(row.text);
  }
}

function expectAggregateMatches(
  store: JournalStore,
  model: StoreModel,
  entries: readonly RowEntry[],
): void {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  const kinds = slotKindsOf(version.slots);
  expect(version.aggregate).toStrictEqual(naiveAggregate(entries, kinds));
  let bloom = 0n;
  for (const row of model.rows) bloom |= ownerBloomBit(row.owner);
  expect({
    rows: version.aggregate.rows,
    curated: version.aggregate.curated,
    ownerBloom: version.aggregate.ownerBloom,
  }).toStrictEqual({
    rows: model.rows.length,
    curated: model.rows.length,
    ownerBloom: bloom,
  });
  const lastRowOffset =
    entries.length === 0 ? 0 : entries[entries.length - 1].recordOffset;
  expect({
    rows: version.rows,
    nextLabel: version.nextLabel,
    firstLabel: version.firstLabel,
    lastOwner: version.lastOwner,
    lastRowOffset: version.lastRowOffset,
  }).toStrictEqual({
    rows: model.rows.length,
    nextLabel: model.next,
    firstLabel: model.rows[0]?.label ?? 0n,
    lastOwner: model.rows[model.rows.length - 1]?.owner ?? 0,
    lastRowOffset,
  });
}

async function expectListMatches(
  store: JournalStore,
  [family, kind, normalized]: [NormalizedFamily, OccurrenceKind, string],
  expected: ReadonlyArray<{ label: bigint; part: number; unit: number }>,
): Promise<void> {
  const queries = store.idFacts();
  expect(await queries.normalizedCount(family, kind, normalized)).toBe(
    expected.length,
  );
  for (const [index, position] of expected.entries()) {
    expect(
      await queries.normalizedPosition(family, kind, normalized, index + 1),
    ).toStrictEqual(position);
  }
}

async function expectFactsMatch(
  store: JournalStore,
  rows: readonly ModelRow[],
): Promise<void> {
  const naive = naiveState(occurrencesOfModel(rows), normalizeFor);
  const queries = store.idFacts();
  const ids = new Set<string>([...ID_SHAPES, ...naive.facts.keys()]);
  for (const rawId of ids) {
    expect(await queries.fact(rawId)).toStrictEqual(naive.facts.get(rawId));
    for (const kind of KINDS) {
      const chain = naive.chains.get(`${kind}:${rawId}`) ?? [];
      for (const [index, entry] of chain.entries()) {
        expect(await queries.occurrence(rawId, kind, index + 1)).toStrictEqual(
          entry,
        );
      }
      expect(
        await queries.occurrence(rawId, kind, chain.length + 1),
      ).toBeUndefined();
    }
    for (const family of FAMILIES) {
      for (const kind of KINDS) {
        const normalized = normalizeFor(family, rawId);
        await expectListMatches(
          store,
          [family, kind, normalized],
          naive.normalized.get(listKey(family, kind, normalized)) ?? [],
        );
      }
    }
  }
  await expectExceptionsMatch(store, naive.exceptions);
}

async function expectExceptionsMatch(
  store: JournalStore,
  exceptions: readonly string[],
): Promise<void> {
  const stored = await store.getMeta('kimi:exc');
  expect(stored === undefined ? 0 : Number(decodeDecimal(stored))).toBe(
    exceptions.length,
  );
  const queries = store.idFacts();
  for (const [index, rawId] of exceptions.entries()) {
    const hash = await queries.exceptionHash(index);
    expect(hash === undefined ? undefined : hex(hash)).toBe(
      hex(sha256KeyHash(ID_NS.fact, new TextEncoder().encode(rawId))),
    );
  }
  expect(await queries.exceptionHash(exceptions.length)).toBeUndefined();
}

async function expectParentListsMatch(
  store: JournalStore,
  rows: readonly ModelRow[],
): Promise<void> {
  for (const endpoint of ENDPOINTS) {
    const labels = rows
      .filter(
        (row) =>
          (row.flags & ROW_FLAG.responseParent) !== 0 &&
          row.endpoint === endpoint,
      )
      .map((row) => row.label);
    const count = await store.getMeta(parentCountKey(endpoint));
    expect(count === undefined ? 0 : Number(decodeDecimal(count))).toBe(
      labels.length,
    );
    for (const [index, label] of labels.entries()) {
      const stored = await store.getMeta(parentListKey(endpoint, index + 1));
      expect(stored === undefined ? undefined : decodeDecimal(stored)).toBe(
        label,
      );
    }
    expect(
      await store.getMeta(parentListKey(endpoint, labels.length + 1)),
    ).toBeUndefined();
  }
}

/**
 * Compares a store with the model on everything the design 13.6 names: the
 * live rows (values and owners), the root aggregate against a naive fold of
 * the entries, and the facts of every id against a naive recomputation.
 */
export async function expectStoreMatchesModel(
  store: JournalStore,
  model: StoreModel,
): Promise<void> {
  const entries = await entriesOf(store);
  await expectRowsMatch(store, model, entries);
  expectAggregateMatches(store, model, entries);
  await expectFactsMatch(store, model.rows);
  await expectParentListsMatch(store, model.rows);
}
