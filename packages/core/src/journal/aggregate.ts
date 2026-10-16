/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertAllZero,
  getU64,
  getU64Big,
  putU32,
  putU64,
  putU64Big,
  span,
  viewOf,
  type Quad,
  type Triple,
} from './bytes.js';
import { JournalFormatError } from './errors.js';
import { SLOT_SUMMARY_BYTES } from './slotSummary.js';

/** The plain part, 252 bytes of fields and 4 reserved. */
export const AGGREGATE_PLAIN_BYTES = 256;
/** 256-byte plain part and three 296-byte summary slots. */
export const AGGREGATE_BYTES = 1144;

/**
 * Offsets of design section 2.5. Widths are the design's byte counts spread
 * over its fields: counts are u32, byte and character totals are u64, labels
 * and the owner bloom are u64 bit patterns.
 */
export const AGGREGATE_LAYOUT = {
  rows: span(0, 4),
  curated: span(4, 4),
  units: span(8, 4),
  tokens: span(12, 32),
  tokensMissing: span(44, 16),
  liveBytes: span(60, 8),
  mediaChars: span(68, 8),
  imageChars: span(76, 24),
  pdfBytes: span(100, 24),
  imageRows: span(124, 4),
  thinkingRows: span(128, 4),
  callRows: span(132, 4),
  reconRows: span(136, 4),
  pairSensitiveRows: span(140, 4),
  imageContribRows: span(144, 4),
  callBlocks: span(148, 4),
  unmappedBlocks: span(152, 4),
  lastThinking: span(156, 8),
  lastInvalidate: span(164, 8),
  lastCacheable: span(172, 8),
  firstAnchor: span(180, 8),
  firstImage: span(188, 8),
  ownerBloom: span(196, 8),
  missingBase: span(204, 12),
  missingImg: span(216, 12),
  stamp: span(228, 24),
  reserved: span(252, 4),
  summaries: span(256, 888),
};

export interface SlotStamp {
  readonly gen: number;
  readonly imageGen: number;
}

export interface Aggregate {
  readonly rows: number;
  readonly curated: number;
  readonly units: number;
  readonly tokens: Quad<number>;
  readonly tokensMissing: Quad<number>;
  readonly liveBytes: number;
  readonly mediaChars: number;
  readonly imageChars: Triple<number>;
  readonly pdfBytes: Triple<number>;
  readonly imageRows: number;
  readonly thinkingRows: number;
  readonly callRows: number;
  readonly reconRows: number;
  readonly pairSensitiveRows: number;
  readonly imageContribRows: number;
  readonly callBlocks: number;
  readonly unmappedBlocks: number;
  readonly lastThinking: bigint;
  readonly lastInvalidate: bigint;
  readonly lastCacheable: bigint;
  readonly firstAnchor: bigint;
  readonly firstImage: bigint;
  readonly ownerBloom: bigint;
  readonly missingBase: Triple<number>;
  readonly missingImg: Triple<number>;
  readonly stamp: Triple<SlotStamp>;
  /**
   * The three transfer-summary slots as 296 raw bytes each. Which format a slot
   * holds is not recorded in the layout, so decoding is left to the caller that
   * knows it (`decodeSlotSummary`).
   */
  readonly summaries: Triple<Uint8Array>;
}

const U32_FIELDS = [
  'rows',
  'curated',
  'units',
  'imageRows',
  'thinkingRows',
  'callRows',
  'reconRows',
  'pairSensitiveRows',
  'imageContribRows',
  'callBlocks',
  'unmappedBlocks',
] as const;
const U64_NUMBER_FIELDS = ['liveBytes', 'mediaChars'] as const;
const U64_BIG_FIELDS = [
  'lastThinking',
  'lastInvalidate',
  'lastCacheable',
  'firstAnchor',
  'firstImage',
  'ownerBloom',
] as const;

function putU64s(
  view: DataView,
  start: number,
  name: string,
  values: readonly number[],
): void {
  values.forEach((value, index) =>
    putU64(view, start + 8 * index, name, value),
  );
}

function putU32s(
  view: DataView,
  start: number,
  name: string,
  values: readonly number[],
): void {
  values.forEach((value, index) =>
    putU32(view, start + 4 * index, name, value),
  );
}

export function encodeAggregateInto(
  target: Uint8Array,
  offset: number,
  aggregate: Aggregate,
): void {
  const view = viewOf(target);
  const at = (name: keyof typeof AGGREGATE_LAYOUT): number =>
    offset + AGGREGATE_LAYOUT[name].offset;
  for (const name of U32_FIELDS) putU32(view, at(name), name, aggregate[name]);
  for (const name of U64_NUMBER_FIELDS)
    putU64(view, at(name), name, aggregate[name]);
  for (const name of U64_BIG_FIELDS)
    putU64Big(view, at(name), name, aggregate[name]);
  putU64s(view, at('tokens'), 'tokens', aggregate.tokens);
  putU32s(view, at('tokensMissing'), 'tokensMissing', aggregate.tokensMissing);
  putU64s(view, at('imageChars'), 'imageChars', aggregate.imageChars);
  putU64s(view, at('pdfBytes'), 'pdfBytes', aggregate.pdfBytes);
  putU32s(view, at('missingBase'), 'missingBase', aggregate.missingBase);
  putU32s(view, at('missingImg'), 'missingImg', aggregate.missingImg);
  aggregate.stamp.forEach((stamp, index) => {
    putU32(view, at('stamp') + 8 * index, 'stamp gen', stamp.gen);
    putU32(view, at('stamp') + 8 * index + 4, 'stamp imageGen', stamp.imageGen);
  });
  aggregate.summaries.forEach((summary, index) => {
    if (summary.length !== SLOT_SUMMARY_BYTES) {
      throw new JournalFormatError(
        `Summary slot ${index} must be ${SLOT_SUMMARY_BYTES} bytes, got ${summary.length}`,
      );
    }
    target.set(summary, at('summaries') + SLOT_SUMMARY_BYTES * index);
  });
}

export function encodeAggregate(aggregate: Aggregate): Uint8Array {
  const bytes = new Uint8Array(AGGREGATE_BYTES);
  encodeAggregateInto(bytes, 0, aggregate);
  return bytes;
}

function readU64s3(
  view: DataView,
  start: number,
  name: string,
): Triple<number> {
  return [
    getU64(view, start, name),
    getU64(view, start + 8, name),
    getU64(view, start + 16, name),
  ];
}

function readU32s3(view: DataView, start: number): Triple<number> {
  return [
    view.getUint32(start, true),
    view.getUint32(start + 4, true),
    view.getUint32(start + 8, true),
  ];
}

function readStamp(view: DataView, start: number): SlotStamp {
  return {
    gen: view.getUint32(start, true),
    imageGen: view.getUint32(start + 4, true),
  };
}

export function decodeAggregate(source: Uint8Array, offset = 0): Aggregate {
  if (source.length < offset + AGGREGATE_BYTES) {
    throw new JournalFormatError(
      `Aggregate needs ${AGGREGATE_BYTES} bytes at ${offset}, only ${source.length - offset} available`,
    );
  }
  const L = AGGREGATE_LAYOUT;
  assertAllZero(
    source,
    offset + L.reserved.offset,
    offset + L.reserved.offset + L.reserved.size,
    'Aggregate reserved bytes',
  );
  const view = viewOf(source);
  const u32 = (name: keyof typeof L): number =>
    view.getUint32(offset + L[name].offset, true);
  const u64 = (name: keyof typeof L): number =>
    getU64(view, offset + L[name].offset, name);
  const big = (name: keyof typeof L): bigint =>
    getU64Big(view, offset + L[name].offset);
  const summary = (index: number): Uint8Array => {
    const start = offset + L.summaries.offset + SLOT_SUMMARY_BYTES * index;
    return source.slice(start, start + SLOT_SUMMARY_BYTES);
  };
  const tokens = offset + L.tokens.offset;
  const tokensMissing = offset + L.tokensMissing.offset;
  const stamp = offset + L.stamp.offset;
  return {
    rows: u32('rows'),
    curated: u32('curated'),
    units: u32('units'),
    tokens: [
      ...readU64s3(view, tokens, 'tokens'),
      getU64(view, tokens + 24, 'tokens'),
    ],
    tokensMissing: [
      ...readU32s3(view, tokensMissing),
      view.getUint32(tokensMissing + 12, true),
    ],
    liveBytes: u64('liveBytes'),
    mediaChars: u64('mediaChars'),
    imageChars: readU64s3(view, offset + L.imageChars.offset, 'imageChars'),
    pdfBytes: readU64s3(view, offset + L.pdfBytes.offset, 'pdfBytes'),
    imageRows: u32('imageRows'),
    thinkingRows: u32('thinkingRows'),
    callRows: u32('callRows'),
    reconRows: u32('reconRows'),
    pairSensitiveRows: u32('pairSensitiveRows'),
    imageContribRows: u32('imageContribRows'),
    callBlocks: u32('callBlocks'),
    unmappedBlocks: u32('unmappedBlocks'),
    lastThinking: big('lastThinking'),
    lastInvalidate: big('lastInvalidate'),
    lastCacheable: big('lastCacheable'),
    firstAnchor: big('firstAnchor'),
    firstImage: big('firstImage'),
    ownerBloom: big('ownerBloom'),
    missingBase: readU32s3(view, offset + L.missingBase.offset),
    missingImg: readU32s3(view, offset + L.missingImg.offset),
    stamp: [
      readStamp(view, stamp),
      readStamp(view, stamp + 8),
      readStamp(view, stamp + 16),
    ],
    summaries: [summary(0), summary(1), summary(2)],
  };
}
