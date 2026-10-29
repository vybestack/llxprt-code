/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate, SlotStamp } from '../../aggregate.js';
import type { SlotKinds } from '../../aggregateComposition.js';
import { SLOT_SUMMARY_BYTES, encodeSlotSummary } from '../../slotSummary.js';
import type { SeededRandom } from './seededRandom.js';
import { randomValidSummary } from './validSummaries.js';

const NO_SEQ = 0xffff_ffff_ffff_ffffn;

function triple<T>(make: () => T): readonly [T, T, T] {
  return [make(), make(), make()];
}

function quad<T>(make: () => T): readonly [T, T, T, T] {
  return [make(), make(), make(), make()];
}

/** A label field: 0 (no row qualifies) about a third of the time. */
function labelOrNone(random: SeededRandom): bigint {
  return random.int(3) === 0 ? 0n : BigInt(1 + random.int(100_000));
}

function randomStamp(random: SeededRandom): SlotStamp {
  return { gen: 1 + random.int(2), imageGen: 1 + random.int(2) };
}

export function summariesFor(
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
 * The aggregate of one row with small random fields, so sums of tens of
 * thousands of them stay inside every field width. `varyStamps` false gives every
 * slot the same stamp.
 */
export function randomRowAggregate(
  random: SeededRandom,
  kinds: SlotKinds,
  varyStamps = true,
): Aggregate {
  const small = () => random.int(6);
  const stamp = () =>
    varyStamps ? randomStamp(random) : { gen: 1, imageGen: 1 };
  const speaker = random.int(3);
  const label = (own: number): bigint =>
    speaker === own ? BigInt(1 + random.int(100_000)) : 0n;
  const seq = random.int(5) === 0 ? NO_SEQ : BigInt(random.int(1000));
  return {
    rows: 1,
    curated: random.int(2),
    units: small(),
    tokens: quad(() => random.int(5000)),
    tokensMissing: quad(() => random.int(2)),
    liveBytes: random.int(1 << 20),
    mediaChars: random.int(1 << 20),
    imageChars: triple(() => random.int(1 << 20)),
    pdfBytes: triple(() => random.int(1 << 20)),
    imageRows: random.int(2),
    mediaContribRows: random.int(2),
    thinkingRows: random.int(2),
    callRows: random.int(2),
    reconRows: random.int(2),
    pairSensitiveRows: random.int(2),
    imageContribRows: random.int(2),
    callBlocks: small(),
    unmappedBlocks: small(),
    humanRows: speaker === 0 ? 1 : 0,
    aiRows: speaker === 1 ? 1 : 0,
    toolCallBlocks: small(),
    responseBlocks: small(),
    noChronologyRows: seq === NO_SEQ ? 1 : 0,
    firstSeq: seq,
    lastSeq: seq,
    lastHuman: label(0),
    lastAi: label(1),
    lastTool: label(2),
    lastThinking: labelOrNone(random),
    lastInvalidate: labelOrNone(random),
    lastCacheable: labelOrNone(random),
    firstAnchor: labelOrNone(random),
    firstImage: labelOrNone(random),
    ownerBloom: 1n << BigInt(random.int(64)),
    missingBase: triple(() => random.int(2)),
    missingImg: triple(() => random.int(2)),
    stamp: triple(stamp),
    summaries: summariesFor(random, kinds),
  };
}
