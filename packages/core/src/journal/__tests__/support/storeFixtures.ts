/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { encodeIdFact } from '../../idFactCodec.js';
import { sha256KeyHash } from '../../idKeys.js';
import type {
  JournalStore,
  JournalStoreDependencies,
} from '../../journalStore.js';
import { LABEL_STEP, FIRST_NEXT_LABEL } from '../../labels.js';
import { planOwnRowOccurrences } from '../../ownRowPlanner.js';
import type { RowDraft } from '../../rowDraft.js';
import {
  CHRONOLOGY_SEQ_NONE,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '../../rowRecord.js';
import { realDeps } from './idFactFixture.js';
import { testJournalSeams, type TestJournalSeams } from './journalFixtures.js';
import { testAlgebra } from './rowTreeFixtures.js';
import type { IdNodeCache } from '../../idTrieCache.js';
import type { FileOperations } from '../../compactionSwap.js';

export const plainPlanner = planOwnRowOccurrences;

export interface StoreFixtureOptions {
  readonly seams?: TestJournalSeams;
  readonly createCache?: () => IdNodeCache;
  readonly fileOperations?: FileOperations;
  readonly compactionDue?: JournalStoreDependencies['compactionDue'];
}

export function storeDeps(
  options: StoreFixtureOptions = {},
): JournalStoreDependencies {
  const seams = options.seams ?? testJournalSeams();
  return {
    journal: seams.dependencies,
    idDeps: realDeps(sha256KeyHash),
    planOccurrences: plainPlanner,
    algebra: testAlgebra,
    createCache: options.createCache,
    fileOperations: options.fileOperations,
    compactionDue: options.compactionDue,
  };
}

export interface DraftOptions {
  readonly owner?: number;
  readonly speaker?: number;
  readonly flags?: number;
  readonly chronologySeq?: bigint;
  readonly parentEndpoint?: bigint;
  /** Raw ids of tool calls, then of tool responses, one block each. */
  readonly calls?: readonly string[];
  readonly responses?: readonly string[];
  readonly text?: string;
}

/** A row with a text block and one block for each call and response id. */
export function draftRow(options: DraftOptions = {}): RowDraft {
  const calls = options.calls ?? [];
  const responses = options.responses ?? [];
  const encoder = new TextEncoder();
  const blocks = [
    { type: 0, bytes: encoder.encode(options.text ?? 'text') },
    ...calls.map((id) => ({ type: 1, bytes: encoder.encode(`call ${id}`) })),
    ...responses.map((id) => ({
      type: 2,
      bytes: encoder.encode(`response ${id}`),
    })),
  ];
  return {
    owner: options.owner ?? 0,
    speaker: options.speaker ?? ROW_SPEAKER.human,
    flags: (options.flags ?? 0) | ROW_FLAG.curated,
    chronologySeq: options.chronologySeq ?? CHRONOLOGY_SEQ_NONE,
    chronologyUserTurn: 0,
    chronologyStep: 0,
    chronologyRecordedAt: 1_900_000_000_000,
    parentEndpoint: options.parentEndpoint ?? 0n,
    ids: [
      ...calls.map((rawId, index) => ({
        rawId,
        kind: ROW_ID_KIND.call,
        block: 1 + index,
        score: 0,
        nameLen: 4,
      })),
      ...responses.map((rawId, index) => ({
        rawId,
        kind: ROW_ID_KIND.response,
        block: 1 + calls.length + index,
        score: 1,
        nameLen: 0,
      })),
    ],
    meta: encoder.encode('{"speaker":"x"}'),
    blocks,
  };
}

/** A test-side array of the rows a journal should hold, with the label rule of design 2.6. */
export class ArrayModel {
  private labels: bigint[] = [];
  private next = FIRST_NEXT_LABEL;

  get liveLabels(): readonly bigint[] {
    return this.labels;
  }

  get nextLabel(): bigint {
    return this.next;
  }

  /** The labels `count` appended rows get. */
  append(count: number): bigint[] {
    const taken: bigint[] = [];
    for (let at = 0; at < count; at++) {
      taken.push(this.next);
      this.labels.push(this.next);
      this.next += LABEL_STEP;
    }
    return taken;
  }

  /** Removes every row at or above `cut` and returns how many went. */
  popFrom(cut: bigint): number {
    const keep = this.labels.filter((label) => label < cut);
    const removed = this.labels.length - keep.length;
    this.labels = keep;
    return removed;
  }

  clear(): void {
    this.labels = [];
  }

  replaceWith(labels: readonly bigint[]): void {
    this.labels = [...labels];
  }
}

export async function labelsOf(store: JournalStore): Promise<bigint[]> {
  const labels: bigint[] = [];
  for await (const entry of store.rows()) labels.push(entry.label);
  return labels;
}

/** The ids the scenario rows use. */
export const SCENARIO_IDS = ['a', 'b', 'c', 'd', 'e'] as const;

/** The encoded fact of each id, or `none`, so two stores can be compared byte for byte. */
export async function factSnapshot(
  store: JournalStore,
  ids: readonly string[] = SCENARIO_IDS,
): Promise<string[]> {
  const queries = await store.idFacts();
  try {
    const out: string[] = [];
    for (const id of ids) {
      const fact = await queries.fact(id);
      out.push(
        fact === undefined
          ? 'none'
          : Buffer.from(encodeIdFact(fact)).toString('hex'),
      );
    }
    return out;
  } finally {
    queries.close();
  }
}

const META_KEYS = [
  'parent:0:count',
  'parent:0:1',
  'parent:0:2',
  'parent:7:count',
  'parent:7:1',
  'kimi:exc',
] as const;

export async function metaSnapshot(store: JournalStore): Promise<string[]> {
  const out: string[] = [];
  for (const key of META_KEYS) {
    const value = await store.getMeta(key);
    out.push(value === undefined ? 'none' : new TextDecoder().decode(value));
  }
  return out;
}

export async function appendEach(
  store: JournalStore,
  drafts: readonly RowDraft[],
): Promise<void> {
  for (const draft of drafts) {
    await store.commit([{ kind: 'append', rows: [draft] }]);
  }
}

/**
 * Six rows with calls, responses and two kinds of parent row: the usual
 * material of the pop scenarios.
 */
export function scenarioDrafts(): RowDraft[] {
  return [
    draftRow({ text: 'zero' }),
    draftRow({
      speaker: ROW_SPEAKER.ai,
      calls: ['a'],
      flags: ROW_FLAG.responseParent,
    }),
    draftRow({ speaker: ROW_SPEAKER.tool, responses: ['a'] }),
    draftRow({
      speaker: ROW_SPEAKER.ai,
      calls: ['b', 'c'],
      flags: ROW_FLAG.responseParent,
      parentEndpoint: 7n,
    }),
    draftRow({ speaker: ROW_SPEAKER.tool, responses: ['b'] }),
    draftRow({
      speaker: ROW_SPEAKER.ai,
      calls: ['d'],
      flags: ROW_FLAG.responseParent,
    }),
  ];
}
