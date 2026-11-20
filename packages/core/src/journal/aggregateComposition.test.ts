/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  AGGREGATE_BYTES,
  decodeAggregate,
  encodeAggregate,
  type Aggregate,
  type SlotStamp,
} from './aggregate.js';
import {
  EMPTY_AGGREGATE,
  composeAggregates,
  type SlotKinds,
} from './aggregateComposition.js';
import { JournalFormatError } from './errors.js';
import {
  SLOT_SUMMARY_BYTES,
  decodeSlotSummary,
  encodeSlotSummary,
  type SlotSummary,
} from './slotSummary.js';
import { composeSlotSummaries } from './summaryComposition.js';
import { randomRowAggregate } from './__tests__/support/rowAggregates.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

const KINDS: SlotKinds = ['anthropic', 'chat', 'responses'];
const CASES = 200;

type Quad = readonly [number, number, number, number];
type Triple = readonly [number, number, number];

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);
const sumBy = (rows: readonly Aggregate[], pick: (row: Aggregate) => number) =>
  sum(rows.map(pick));
const sumQuad = (
  rows: readonly Aggregate[],
  pick: (row: Aggregate) => Quad,
): Quad => [
  sumBy(rows, (row) => pick(row)[0]),
  sumBy(rows, (row) => pick(row)[1]),
  sumBy(rows, (row) => pick(row)[2]),
  sumBy(rows, (row) => pick(row)[3]),
];
const sumTriple = (
  rows: readonly Aggregate[],
  pick: (row: Aggregate) => Triple,
): Triple => [
  sumBy(rows, (row) => pick(row)[0]),
  sumBy(rows, (row) => pick(row)[1]),
  sumBy(rows, (row) => pick(row)[2]),
];

function nonZero(values: readonly bigint[]): bigint[] {
  return values.filter((value) => value !== 0n);
}

/** The largest label among the rows that have one, or 0 for none. */
function lastLabel(values: readonly bigint[]): bigint {
  return nonZero(values).reduce(
    (best, value) => (value > best ? value : best),
    0n,
  );
}

/** The smallest label among the rows that have one, or 0 for none. */
function firstLabel(values: readonly bigint[]): bigint {
  const present = nonZero(values);
  return present.length === 0
    ? 0n
    : present.reduce((best, value) => (value < best ? value : best));
}

function commonOrZero(values: readonly number[]): number {
  return values.every((value) => value === values[0]) ? values[0] : 0;
}

function naiveStamp(rows: readonly Aggregate[], slot: 0 | 1 | 2): SlotStamp {
  return {
    gen: commonOrZero(rows.map((row) => row.stamp[slot].gen)),
    imageGen: commonOrZero(rows.map((row) => row.stamp[slot].imageGen)),
  };
}

function decodedSlot(row: Aggregate, slot: 0 | 1 | 2): SlotSummary {
  return decodeSlotSummary(row.summaries[slot], { summaryKind: KINDS[slot] });
}

/** Left fold of one slot's summaries, starting from the first row. */
function naiveSummary(rows: readonly Aggregate[], slot: 0 | 1 | 2): Uint8Array {
  const composed = rows
    .slice(1)
    .reduce(
      (acc, row) => composeSlotSummaries(acc, decodedSlot(row, slot)),
      decodedSlot(rows[0], slot),
    );
  return encodeSlotSummary(composed);
}

/** What a range of rows must aggregate to, computed field by field with no composition helper. */
function naiveFold(rows: readonly Aggregate[]): Aggregate {
  const pick = <K extends keyof Aggregate>(key: K) =>
    rows.map((row) => row[key]);
  return {
    rows: sumBy(rows, (row) => row.rows),
    curated: sumBy(rows, (row) => row.curated),
    units: sumBy(rows, (row) => row.units),
    tokens: sumQuad(rows, (row) => row.tokens),
    tokensMissing: sumQuad(rows, (row) => row.tokensMissing),
    liveBytes: sumBy(rows, (row) => row.liveBytes),
    mediaChars: sumBy(rows, (row) => row.mediaChars),
    imageChars: sumTriple(rows, (row) => row.imageChars),
    pdfBytes: sumTriple(rows, (row) => row.pdfBytes),
    imageRows: sumBy(rows, (row) => row.imageRows),
    mediaContribRows: sumBy(rows, (row) => row.mediaContribRows),
    thinkingRows: sumBy(rows, (row) => row.thinkingRows),
    callRows: sumBy(rows, (row) => row.callRows),
    reconRows: sumBy(rows, (row) => row.reconRows),
    pairSensitiveRows: sumBy(rows, (row) => row.pairSensitiveRows),
    imageContribRows: sumBy(rows, (row) => row.imageContribRows),
    callBlocks: sumBy(rows, (row) => row.callBlocks),
    unmappedBlocks: sumBy(rows, (row) => row.unmappedBlocks),
    humanRows: sumBy(rows, (row) => row.humanRows),
    aiRows: sumBy(rows, (row) => row.aiRows),
    toolCallBlocks: sumBy(rows, (row) => row.toolCallBlocks),
    responseBlocks: sumBy(rows, (row) => row.responseBlocks),
    noChronologyRows: sumBy(rows, (row) => row.noChronologyRows),
    firstSeq: rows[0].firstSeq,
    lastSeq: rows[rows.length - 1].lastSeq,
    lastHuman: lastLabel(pick('lastHuman')),
    lastAi: lastLabel(pick('lastAi')),
    lastTool: lastLabel(pick('lastTool')),
    lastThinking: lastLabel(pick('lastThinking')),
    lastInvalidate: lastLabel(pick('lastInvalidate')),
    lastCacheable: lastLabel(pick('lastCacheable')),
    firstAnchor: firstLabel(pick('firstAnchor')),
    firstImage: firstLabel(pick('firstImage')),
    ownerBloom: pick('ownerBloom').reduce((bits, value) => bits | value, 0n),
    missingBase: sumTriple(rows, (row) => row.missingBase),
    missingImg: sumTriple(rows, (row) => row.missingImg),
    stamp: [naiveStamp(rows, 0), naiveStamp(rows, 1), naiveStamp(rows, 2)],
    summaries: [
      naiveSummary(rows, 0),
      naiveSummary(rows, 1),
      naiveSummary(rows, 2),
    ],
  };
}

function foldWithEmpty(rows: readonly Aggregate[]): Aggregate {
  return rows.reduce(
    (acc, row) => composeAggregates(acc, row, KINDS),
    EMPTY_AGGREGATE,
  );
}

function treeFold(rows: readonly Aggregate[]): Aggregate {
  if (rows.length === 0) return EMPTY_AGGREGATE;
  if (rows.length === 1)
    return composeAggregates(EMPTY_AGGREGATE, rows[0], KINDS);
  const middle = Math.floor(rows.length / 2);
  return composeAggregates(
    treeFold(rows.slice(0, middle)),
    treeFold(rows.slice(middle)),
    KINDS,
  );
}

function rowsOf(random: SeededRandom, count: number): Aggregate[] {
  return Array.from({ length: count }, () => randomRowAggregate(random, KINDS));
}

describe('aggregate composition', () => {
  it('equals a naive fold of the per-row aggregates', () => {
    const random = new SeededRandom(41);
    for (let index = 0; index < CASES; index++) {
      const rows = rowsOf(random, 1 + random.int(30));

      expect(foldWithEmpty(rows)).toStrictEqual(naiveFold(rows));
    }
  });

  it('gives the same aggregate for every tree shape over the same rows', () => {
    const random = new SeededRandom(42);
    for (let index = 0; index < CASES; index++) {
      const rows = rowsOf(random, 1 + random.int(40));

      expect(treeFold(rows)).toStrictEqual(foldWithEmpty(rows));
    }
  });

  it('keeps the composed aggregate encodable and equal after a round trip', () => {
    const random = new SeededRandom(43);
    const folded = foldWithEmpty(rowsOf(random, 25));

    const bytes = encodeAggregate(folded);

    expect(bytes.length).toBe(AGGREGATE_BYTES);
    expect(decodeAggregate(bytes)).toStrictEqual(folded);
  });

  it('takes the first seq from the first non-empty side and the last seq from the last one', () => {
    const random = new SeededRandom(45);
    const [first, middle, last] = rowsOf(random, 3);
    const none = 0xffff_ffff_ffff_ffffn;
    const unstamped = { ...middle, firstSeq: none, lastSeq: none };

    const composed = composeAggregates(
      composeAggregates(EMPTY_AGGREGATE, first, KINDS),
      composeAggregates(
        unstamped,
        composeAggregates(last, EMPTY_AGGREGATE, KINDS),
        KINDS,
      ),
      KINDS,
    );

    expect(composed.firstSeq).toBe(first.firstSeq);
    expect(composed.lastSeq).toBe(last.lastSeq);
    expect(composeAggregates(unstamped, EMPTY_AGGREGATE, KINDS).lastSeq).toBe(
      none,
    );
  });

  it('treats the empty aggregate as the identity on either side, summaries included', () => {
    const random = new SeededRandom(44);
    const row = randomRowAggregate(random, KINDS);

    expect(composeAggregates(EMPTY_AGGREGATE, row, KINDS)).toStrictEqual(row);
    expect(composeAggregates(row, EMPTY_AGGREGATE, KINDS)).toStrictEqual(row);
    expect(
      composeAggregates(EMPTY_AGGREGATE, EMPTY_AGGREGATE, KINDS),
    ).toStrictEqual(EMPTY_AGGREGATE);
  });

  it('is all zero bytes when empty', () => {
    expect(encodeAggregate(EMPTY_AGGREGATE).every((byte) => byte === 0)).toBe(
      true,
    );
  });
});

describe('labels in composition: 0 means none', () => {
  const withLabels = (fields: Partial<Aggregate>): Aggregate => ({
    ...randomRowAggregate(new SeededRandom(5), KINDS, false),
    lastThinking: 0n,
    lastInvalidate: 0n,
    lastCacheable: 0n,
    firstAnchor: 0n,
    firstImage: 0n,
    ...fields,
  });

  it('takes the larger of two max labels and keeps one when the other is none', () => {
    const none = withLabels({});
    const nine = withLabels({ lastThinking: 9n, lastCacheable: 4n });
    const seven = withLabels({ lastThinking: 7n, lastInvalidate: 2n });

    const both = composeAggregates(nine, seven, KINDS);
    const withNone = composeAggregates(none, seven, KINDS);

    expect(both.lastThinking).toBe(9n);
    expect(both.lastInvalidate).toBe(2n);
    expect(both.lastCacheable).toBe(4n);
    expect(withNone.lastThinking).toBe(7n);
    expect(composeAggregates(none, none, KINDS).lastThinking).toBe(0n);
  });

  it('takes the smaller nonzero of two min labels and never reports 0 for a range that has one', () => {
    const none = withLabels({});
    const five = withLabels({ firstAnchor: 5n, firstImage: 8n });
    const three = withLabels({ firstAnchor: 3n });

    const both = composeAggregates(five, three, KINDS);

    expect(both.firstAnchor).toBe(3n);
    expect(both.firstImage).toBe(8n);
    expect(composeAggregates(none, five, KINDS).firstAnchor).toBe(5n);
    expect(composeAggregates(five, none, KINDS).firstAnchor).toBe(5n);
    expect(composeAggregates(none, none, KINDS).firstAnchor).toBe(0n);
  });

  it('ors the owner bloom', () => {
    const low = withLabels({ ownerBloom: 0b0101n });
    const high = withLabels({ ownerBloom: 1n << 63n });

    expect(composeAggregates(low, high, KINDS).ownerBloom).toBe(
      (1n << 63n) | 0b0101n,
    );
  });
});

describe('stamps in composition', () => {
  const stamped = (stamp: SlotStamp): Aggregate => ({
    ...randomRowAggregate(new SeededRandom(6), KINDS, false),
    stamp: [stamp, stamp, stamp],
  });

  it('keeps a stamp both sides agree on', () => {
    const stamp = { gen: 3, imageGen: 2 };

    const composed = composeAggregates(stamped(stamp), stamped(stamp), KINDS);

    expect(composed.stamp).toStrictEqual([stamp, stamp, stamp]);
  });

  it('drops to the stamp of no generation when the sides disagree, so the node reads as stale', () => {
    const composed = composeAggregates(
      stamped({ gen: 3, imageGen: 2 }),
      stamped({ gen: 3, imageGen: 5 }),
      KINDS,
    );

    expect(composed.stamp[0]).toStrictEqual({ gen: 3, imageGen: 0 });
    const differentGen = composeAggregates(
      stamped({ gen: 3, imageGen: 2 }),
      stamped({ gen: 4, imageGen: 2 }),
      KINDS,
    );
    expect(differentGen.stamp[1]).toStrictEqual({ gen: 0, imageGen: 2 });
  });
});

describe('summary slots in composition', () => {
  it('leaves an unassigned slot all zero', () => {
    const kinds: SlotKinds = ['chat', null, null];
    const random = new SeededRandom(8);
    const left = randomRowAggregate(random, kinds);
    const right = randomRowAggregate(random, kinds);

    const composed = composeAggregates(left, right, kinds);

    expect(composed.summaries[1]).toStrictEqual(
      new Uint8Array(SLOT_SUMMARY_BYTES),
    );
    expect(composed.summaries[2]).toStrictEqual(
      new Uint8Array(SLOT_SUMMARY_BYTES),
    );
  });

  it('refuses a nonzero summary in an unassigned slot', () => {
    const random = new SeededRandom(9);
    const row = randomRowAggregate(random, KINDS);

    expect(() =>
      composeAggregates(row, row, ['anthropic', null, 'responses']),
    ).toThrow(JournalFormatError);
  });

  it('composes the three slots by their own kinds', () => {
    const random = new SeededRandom(10);
    const left = randomRowAggregate(random, KINDS);
    const right = randomRowAggregate(random, KINDS);

    const composed = composeAggregates(left, right, KINDS);

    for (const slot of [0, 1, 2] as const) {
      expect(composed.summaries[slot]).toStrictEqual(
        encodeSlotSummary(
          composeSlotSummaries(
            decodedSlot(left, slot),
            decodedSlot(right, slot),
          ),
        ),
      );
    }
  });
});
