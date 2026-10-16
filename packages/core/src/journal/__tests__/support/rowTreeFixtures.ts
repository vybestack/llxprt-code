/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ownerBloomBit } from '../../ownerRules.js';
import type { Aggregate } from '../../aggregate.js';
import {
  EMPTY_AGGREGATE,
  composeAggregates,
  type SlotKinds,
} from '../../aggregateComposition.js';
import {
  ENTRY_FLAG,
  ROW_ENTRY_NO_CHRONOLOGY_SEQ,
  type RowEntry,
} from '../../rowEntry.js';
import { ROW_FLAG } from '../../rowRecord.js';
import { SLOT_SUMMARY_BYTES, encodeSlotSummary } from '../../slotSummary.js';
import type { RowTreeAlgebra } from '../../rowTreeBuilder.js';
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

function labelIf(flags: number, bit: number, label: bigint): bigint {
  return (flags & bit) !== 0 ? label : 0n;
}

/** The slot has no summary when its bytes are all zero. */
function missing(summary: Uint8Array): number {
  return summary.some((byte) => byte !== 0) ? 0 : 1;
}

/**
 * The aggregate a test entry stands for. `units` and `liveBytes` are not
 * derivable from the entry layout of design 3.2, so the test stands in for the
 * writer with its own definitions of them.
 */
export function testAggregateOf(entry: RowEntry): Aggregate {
  const { flags, label } = entry;
  const tokenSlot = (slot: 0 | 1 | 2 | 3): number =>
    entry.tokens[0][slot] + entry.tokens[1][slot] + entry.tokens[2][slot];
  const has = (bit: number): number => ((flags & bit) !== 0 ? 1 : 0);
  return {
    rows: 1,
    curated: has(ROW_FLAG.curated),
    units: 1 + entry.reconBlocks,
    tokens: [tokenSlot(0), tokenSlot(1), tokenSlot(2), tokenSlot(3)],
    tokensMissing: [0, 0, 0, 0],
    liveBytes: entry.recordLength,
    mediaChars: entry.media.mediaChars,
    imageChars: entry.media.imageChars,
    pdfBytes: entry.media.pdfBytes,
    imageRows: has(ROW_FLAG.hasImage),
    thinkingRows: has(ROW_FLAG.hasThinking),
    callRows: has(ROW_FLAG.hasToolCall),
    reconRows: entry.reconBlocks > 0 ? 1 : 0,
    pairSensitiveRows: has(ENTRY_FLAG.pairSensitive),
    imageContribRows: has(ENTRY_FLAG.imageContrib),
    callBlocks: entry.callBlocks,
    unmappedBlocks: entry.unmappedBlocks,
    lastThinking: labelIf(flags, ROW_FLAG.hasThinking, label),
    lastInvalidate: labelIf(flags, ROW_FLAG.invalidateResponses, label),
    lastCacheable: labelIf(flags, ROW_FLAG.hasCacheableBlock, label),
    firstAnchor: labelIf(flags, ROW_FLAG.cacheAnchor, label),
    firstImage: labelIf(flags, ROW_FLAG.hasImage, label),
    ownerBloom: ownerBloomBit(entry.owner),
    missingBase: [
      missing(entry.summary[0]),
      missing(entry.summary[1]),
      missing(entry.summary[2]),
    ],
    missingImg: [0, 0, 0],
    stamp: entry.stamp,
    summaries: entry.summary,
  };
}

export function testAlgebra(kinds: SlotKinds): RowTreeAlgebra {
  return {
    aggregateOf: testAggregateOf,
    compose: (left, right) => composeAggregates(left, right, kinds),
    empty: EMPTY_AGGREGATE,
  };
}

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
