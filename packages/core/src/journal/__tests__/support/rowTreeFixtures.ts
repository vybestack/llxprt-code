/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from '../../aggregate.js';
import {
  EMPTY_AGGREGATE,
  composeAggregates,
  type SlotKinds,
} from '../../aggregateComposition.js';
import { entryAggregate, rowAlgebra } from '../../rowAlgebra.js';
import {
  ENTRY_FLAG,
  ROW_ENTRY_NO_CHRONOLOGY_SEQ,
  type RowEntry,
} from '../../rowEntry.js';
import { SLOT_SUMMARY_BYTES, encodeSlotSummary } from '../../slotSummary.js';
import type { SeededRandom } from './seededRandom.js';
import { randomValidSummary } from './validSummaries.js';

export const TEST_KINDS: SlotKinds = ['anthropic', 'chat', 'responses'];
/** No slot assigned: every summary is zero, which is the cheap case for the big builds. */
export const NO_KINDS: SlotKinds = [null, null, null];

const MAX_ROW_FLAG_BITS = 1 << 11;

function summariesFor(
  random: SeededRandom,
  kinds: SlotKinds,
): readonly [Uint8Array, Uint8Array, Uint8Array] {
  const one = (index: 0 | 1 | 2): Uint8Array => {
    const kind = kinds[index];
    return kind === null
      ? new Uint8Array(SLOT_SUMMARY_BYTES)
      : encodeSlotSummary(randomValidSummary(random, kind));
  };
  return [one(0), one(1), one(2)];
}

/**
 * Row `index` (0-based) with label `(index + 1) * 1000`, so labels are
 * ascending and leave room to look between them. Fields are small enough that
 * sums over a million entries stay inside their widths.
 */
export function syntheticEntry(
  random: SeededRandom,
  index: number,
  kinds: SlotKinds,
): RowEntry {
  const stamp = { gen: 1, imageGen: 1 };
  return {
    label: BigInt(index + 1) * 1000n,
    recordOffset: 4096 + index * 64,
    recordLength: 64 + random.int(200),
    speaker: random.int(3),
    flags:
      random.int(MAX_ROW_FLAG_BITS) |
      (random.int(2) === 0 ? 0 : ENTRY_FLAG.pairSensitive) |
      (random.int(2) === 0 ? 0 : ENTRY_FLAG.imageContrib),
    reconBlocks: random.int(3),
    answered: random.int(3),
    chronologySeq:
      random.int(5) === 0 ? ROW_ENTRY_NO_CHRONOLOGY_SEQ : BigInt(index),
    chronologyUserTurn: random.int(1000),
    chronologyStep: random.int(1000),
    chronologyRecordedAt: 1_900_000_000_000 + index,
    owner: random.int(4),
    callBlocks: random.int(4),
    unmappedBlocks: random.int(2),
    toolCallBlocks: random.int(3),
    responseBlocks: random.int(3),
    lensRef: [random.bits(40), random.bits(40), random.bits(40)],
    summary: summariesFor(random, kinds),
    media: {
      mediaChars: random.int(1 << 16),
      imageChars: [
        random.int(1 << 16),
        random.int(1 << 16),
        random.int(1 << 16),
      ],
      pdfBytes: [random.int(1 << 16), random.int(1 << 16), random.int(1 << 16)],
    },
    tokens: [
      [random.int(500), random.int(500), random.int(500), random.int(500)],
      [random.int(500), random.int(500), random.int(500), random.int(500)],
      [random.int(500), random.int(500), random.int(500), random.int(500)],
    ],
    stamp: [stamp, stamp, stamp],
  };
}

/** The production aggregate of an entry; the tree checks use the same definition. */
export const testAggregateOf = entryAggregate;

export const testAlgebra = rowAlgebra;

/** The aggregate of the entries by a plain left fold, the oracle of every tree check. */
export function naiveAggregate(
  entries: readonly RowEntry[],
  kinds: SlotKinds,
): Aggregate {
  return entries
    .map(testAggregateOf)
    .reduce(
      (acc, aggregate) => composeAggregates(acc, aggregate, kinds),
      EMPTY_AGGREGATE,
    );
}
