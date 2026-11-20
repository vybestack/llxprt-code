/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from './aggregate.js';
import {
  EMPTY_AGGREGATE,
  composeAggregates,
  type SlotKinds,
} from './aggregateComposition.js';
import { ownerBloomBit } from './ownerRules.js';
import {
  ENTRY_FLAG,
  ROW_ENTRY_NO_CHRONOLOGY_SEQ,
  type RowEntry,
} from './rowEntry.js';
import { ROW_FLAG, ROW_SPEAKER } from './rowRecord.js';
import type { RowTreeAlgebra } from './rowTreeBuilder.js';
import { unitCount } from './unitContributions.js';

function labelIf(flags: number, bit: number, label: bigint): bigint {
  return (flags & bit) !== 0 ? label : 0n;
}

/** The slot has no summary when its bytes are all zero. */
function missing(summary: Uint8Array): number {
  return summary.some((byte) => byte !== 0) ? 0 : 1;
}

/**
 * The aggregate of one row entry (design 2.5). `units` is the row itself plus
 * its reconstructed units, and `liveBytes` the length of its `ROW` record;
 * the normalizer of phase 5 and the lengths of phase 7 refine the numbers
 * that depend on a format slot, and fill them through `fill` edits.
 */
export function entryAggregate(entry: RowEntry): Aggregate {
  const { flags, label } = entry;
  const tokenSlot = (slot: 0 | 1 | 2 | 3): number =>
    entry.tokens[0][slot] + entry.tokens[1][slot] + entry.tokens[2][slot];
  const has = (bit: number): number => ((flags & bit) !== 0 ? 1 : 0);
  const ofSpeaker = (speaker: number): number =>
    entry.speaker === speaker ? 1 : 0;
  const labelOfSpeaker = (speaker: number): bigint =>
    entry.speaker === speaker ? label : 0n;
  return {
    rows: 1,
    curated: has(ROW_FLAG.curated),
    units: unitCount(entry),
    tokens: [tokenSlot(0), tokenSlot(1), tokenSlot(2), tokenSlot(3)],
    tokensMissing: [0, 0, 0, 0],
    liveBytes: entry.recordLength,
    mediaChars: entry.media.mediaChars,
    imageChars: entry.media.imageChars,
    pdfBytes: entry.media.pdfBytes,
    imageRows: has(ROW_FLAG.hasImage),
    mediaContribRows: unitCount(entry) > 0 ? has(ROW_FLAG.hasMedia) : 0,
    thinkingRows: has(ROW_FLAG.hasThinking),
    callRows: has(ROW_FLAG.hasToolCall),
    reconRows: entry.reconBlocks > 0 ? 1 : 0,
    pairSensitiveRows: has(ENTRY_FLAG.pairSensitive),
    imageContribRows: has(ENTRY_FLAG.imageContrib),
    callBlocks: entry.callBlocks,
    unmappedBlocks: entry.unmappedBlocks,
    humanRows: ofSpeaker(ROW_SPEAKER.human),
    aiRows: ofSpeaker(ROW_SPEAKER.ai),
    toolCallBlocks: entry.toolCallBlocks,
    responseBlocks: entry.responseBlocks,
    noChronologyRows:
      entry.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ ? 1 : 0,
    firstSeq: entry.chronologySeq,
    lastSeq: entry.chronologySeq,
    lastHuman: labelOfSpeaker(ROW_SPEAKER.human),
    lastAi: labelOfSpeaker(ROW_SPEAKER.ai),
    lastTool: labelOfSpeaker(ROW_SPEAKER.tool),
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

/** The algebra of the row tree for a slot table. */
export function rowAlgebra(kinds: SlotKinds): RowTreeAlgebra {
  return {
    aggregateOf: entryAggregate,
    compose: (left, right) => composeAggregates(left, right, kinds),
    empty: EMPTY_AGGREGATE,
  };
}
