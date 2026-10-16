/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  AGGREGATE_BYTES,
  decodeAggregate,
  type Aggregate,
  type SlotStamp,
} from './aggregate.js';
import type { Quad, Triple } from './bytes.js';
import { JournalFormatError } from './errors.js';
import {
  SLOT_SUMMARY_BYTES,
  decodeSlotSummary,
  encodeSlotSummary,
  type SummaryKind,
} from './slotSummary.js';
import { composeSlotSummaries } from './summaryComposition.js';

/**
 * The summary kind of each format slot, from the trailer's slot table. A slot
 * that has never been assigned a format holds all-zero summaries (design 2.5).
 */
export type SlotKinds = Triple<SummaryKind | null>;

/** The aggregate of no rows: all zero bytes (design 2.5). */
export const EMPTY_AGGREGATE: Aggregate = decodeAggregate(
  new Uint8Array(AGGREGATE_BYTES),
);

function sum3(left: Triple<number>, right: Triple<number>): Triple<number> {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function sum4(left: Quad<number>, right: Quad<number>): Quad<number> {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2],
    left[3] + right[3],
  ];
}

/** Labels are 1-based, so 0 is none and is the identity of the max (design 2.5). */
function maxLabel(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

/** The min skips an operand that is 0: a range with an empty child still has its anchor. */
function minLabel(left: bigint, right: bigint): bigint {
  if (left === 0n) return right;
  if (right === 0n) return left;
  return left < right ? left : right;
}

/**
 * The stamp is the pair a node's numbers were computed for. Two children that
 * agree give that pair. Children that disagree give 0 for the component they
 * disagree on, which no assigned slot has (a slot's `gen` starts at 1 when it
 * is assigned), so the node reads as stale for that component and is filled
 * again (design 8.5). The rule is associative: a component is the common value
 * of every row under the node, or 0.
 */
function composeStamp(left: SlotStamp, right: SlotStamp): SlotStamp {
  return {
    gen: left.gen === right.gen ? left.gen : 0,
    imageGen: left.imageGen === right.imageGen ? left.imageGen : 0,
  };
}

function composeStamps(
  left: Triple<SlotStamp>,
  right: Triple<SlotStamp>,
): Triple<SlotStamp> {
  return [
    composeStamp(left[0], right[0]),
    composeStamp(left[1], right[1]),
    composeStamp(left[2], right[2]),
  ];
}

function isAllZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function composeSummarySlot(
  left: Uint8Array,
  right: Uint8Array,
  kind: SummaryKind | null,
  slot: number,
): Uint8Array {
  if (kind === null) {
    if (!isAllZero(left) || !isAllZero(right)) {
      throw new JournalFormatError(
        `Format slot ${slot} has no summary kind but holds a nonzero summary`,
      );
    }
    return new Uint8Array(SLOT_SUMMARY_BYTES);
  }
  const composed = composeSlotSummaries(
    decodeSlotSummary(left, { summaryKind: kind }),
    decodeSlotSummary(right, { summaryKind: kind }),
  );
  return encodeSlotSummary(composed);
}

function composeSummaries(
  left: Aggregate,
  right: Aggregate,
  kinds: SlotKinds,
): Triple<Uint8Array> {
  // The all-zero summary of an empty range is not the identity function of an
  // assigned slot, so an empty side is skipped and never composed.
  if (left.rows === 0) return right.summaries;
  if (right.rows === 0) return left.summaries;
  return [
    composeSummarySlot(left.summaries[0], right.summaries[0], kinds[0], 0),
    composeSummarySlot(left.summaries[1], right.summaries[1], kinds[1], 1),
    composeSummarySlot(left.summaries[2], right.summaries[2], kinds[2], 2),
  ];
}

function composeStampsOfRanges(left: Aggregate, right: Aggregate) {
  if (left.rows === 0) return right.stamp;
  if (right.rows === 0) return left.stamp;
  return composeStamps(left.stamp, right.stamp);
}

/**
 * The aggregate of two adjacent ranges of rows, `left` before `right`
 * (design 2.5 and 8.3). Counts and totals add, max labels take the larger,
 * min labels the smaller nonzero, the owner bloom is or-ed, and each summary
 * slot composes by the kind its format slot holds. The empty aggregate is the
 * identity on both sides.
 */
export function composeAggregates(
  left: Aggregate,
  right: Aggregate,
  kinds: SlotKinds,
): Aggregate {
  return {
    rows: left.rows + right.rows,
    curated: left.curated + right.curated,
    units: left.units + right.units,
    tokens: sum4(left.tokens, right.tokens),
    tokensMissing: sum4(left.tokensMissing, right.tokensMissing),
    liveBytes: left.liveBytes + right.liveBytes,
    mediaChars: left.mediaChars + right.mediaChars,
    imageChars: sum3(left.imageChars, right.imageChars),
    pdfBytes: sum3(left.pdfBytes, right.pdfBytes),
    imageRows: left.imageRows + right.imageRows,
    thinkingRows: left.thinkingRows + right.thinkingRows,
    callRows: left.callRows + right.callRows,
    reconRows: left.reconRows + right.reconRows,
    pairSensitiveRows: left.pairSensitiveRows + right.pairSensitiveRows,
    imageContribRows: left.imageContribRows + right.imageContribRows,
    callBlocks: left.callBlocks + right.callBlocks,
    unmappedBlocks: left.unmappedBlocks + right.unmappedBlocks,
    lastThinking: maxLabel(left.lastThinking, right.lastThinking),
    lastInvalidate: maxLabel(left.lastInvalidate, right.lastInvalidate),
    lastCacheable: maxLabel(left.lastCacheable, right.lastCacheable),
    firstAnchor: minLabel(left.firstAnchor, right.firstAnchor),
    firstImage: minLabel(left.firstImage, right.firstImage),
    ownerBloom: left.ownerBloom | right.ownerBloom,
    missingBase: sum3(left.missingBase, right.missingBase),
    missingImg: sum3(left.missingImg, right.missingImg),
    stamp: composeStampsOfRanges(left, right),
    summaries: composeSummaries(left, right, kinds),
  };
}
