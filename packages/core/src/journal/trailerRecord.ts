/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  AGGREGATE_BYTES,
  decodeAggregate,
  encodeAggregateInto,
  type Aggregate,
} from './aggregate.js';
import {
  assertAllZero,
  assertLength,
  bytesEqual,
  getU64,
  getU64Big,
  putBytes,
  putU32,
  putU64,
  putU64Big,
  span,
  viewOf,
  type Triple,
} from './bytes.js';
import { JournalFormatError, JournalFrameError } from './errors.js';
import { BODY_CRC_BYTES, decodeFrameStart, encodeFrameStart } from './frame.js';
import {
  isMutationCode,
  RECORD_KIND,
  type MutationCode,
} from './recordKinds.js';
import {
  decodeSlotTable,
  encodeSlotTableInto,
  SLOT_TABLE_BYTES,
  type SlotTable,
} from './slotTable.js';

/** The fixed kind header of a trailer: the whole running state. */
export const TRAILER_HEADER_BYTES = 1480;
/** 16-byte frame head, the kind header, no body, 4-byte body CRC. */
export const TRAILER_RECORD_BYTES = 1500;

const SYNC_MARKER_BYTES = 8;
const GROUP_TAG_LIMIT = 1n << 56n;

/** Offsets of design section 2.5, in the order the design lists the fields. */
export const TRAILER_LAYOUT = {
  selfOffset: span(0, 8),
  commitSeq: span(8, 8),
  parent: span(16, 8),
  skip: span(24, 24),
  lineage: span(48, 8),
  lineageDepth: span(56, 8),
  mutation: span(64, 1),
  groupTag: span(65, 7),
  mutationArg0: span(72, 8),
  mutationArg1: span(80, 8),
  rowRoot: span(88, 8),
  idRoot: span(96, 8),
  metaRoot: span(104, 8),
  stateRoot: span(112, 8),
  nextLabel: span(120, 8),
  firstLabel: span(128, 8),
  lastRowOffset: span(136, 8),
  lastOwner: span(144, 4),
  padding: span(148, 4),
  ckptBytes: span(152, 8),
  rootAggregate: span(160, AGGREGATE_BYTES),
  slots: span(1304, SLOT_TABLE_BYTES),
  durableEnd: span(1464, 8),
  syncMarker: span(1472, SYNC_MARKER_BYTES),
};

/**
 * Offsets, sequence numbers and sizes are numbers (exact up to 2^53-1).
 * Labels, hashes, the lineage id and the mutation arguments are 64-bit
 * patterns and stay bigints.
 */
export interface TrailerHeader {
  readonly selfOffset: number;
  readonly commitSeq: number;
  readonly parent: number;
  /** Ancestors 8, 64 and 512 parent-hops back. */
  readonly skip: Triple<number>;
  readonly lineage: bigint;
  readonly lineageDepth: number;
  readonly mutation: MutationCode;
  /** 56 bits, random per commit group. */
  readonly groupTag: bigint;
  readonly mutationArg0: bigint;
  readonly mutationArg1: bigint;
  readonly rowRoot: number;
  readonly idRoot: number;
  readonly metaRoot: number;
  readonly stateRoot: number;
  readonly nextLabel: bigint;
  readonly firstLabel: bigint;
  readonly lastRowOffset: number;
  readonly lastOwner: number;
  readonly ckptBytes: number;
  readonly rootAggregate: Aggregate;
  readonly slots: SlotTable;
  readonly durableEnd: number;
  readonly syncMarker: Uint8Array;
}

const OFFSET_FIELDS = [
  'selfOffset',
  'commitSeq',
  'parent',
  'lineageDepth',
  'rowRoot',
  'idRoot',
  'metaRoot',
  'stateRoot',
  'lastRowOffset',
  'ckptBytes',
  'durableEnd',
] as const;
const LABEL_FIELDS = [
  'lineage',
  'mutationArg0',
  'mutationArg1',
  'nextLabel',
  'firstLabel',
] as const;

export function encodeTrailerHeader(trailer: TrailerHeader): Uint8Array {
  if (trailer.groupTag < 0n || trailer.groupTag >= GROUP_TAG_LIMIT) {
    throw new JournalFormatError(
      `groupTag ${trailer.groupTag} does not fit 56 bits`,
    );
  }
  const L = TRAILER_LAYOUT;
  const bytes = new Uint8Array(TRAILER_HEADER_BYTES);
  const view = viewOf(bytes);
  for (const name of OFFSET_FIELDS)
    putU64(view, L[name].offset, name, trailer[name]);
  for (const name of LABEL_FIELDS)
    putU64Big(view, L[name].offset, name, trailer[name]);
  trailer.skip.forEach((hop, index) =>
    putU64(view, L.skip.offset + 8 * index, 'skip', hop),
  );
  putU64Big(
    view,
    L.mutation.offset,
    'mutation and groupTag',
    BigInt(trailer.mutation) | (trailer.groupTag << 8n),
  );
  putU32(view, L.lastOwner.offset, 'lastOwner', trailer.lastOwner);
  encodeAggregateInto(bytes, L.rootAggregate.offset, trailer.rootAggregate);
  encodeSlotTableInto(bytes, L.slots.offset, trailer.slots);
  putBytes(
    bytes,
    L.syncMarker.offset,
    'syncMarker',
    trailer.syncMarker,
    SYNC_MARKER_BYTES,
  );
  return bytes;
}

export function decodeTrailerHeader(bytes: Uint8Array): TrailerHeader {
  assertLength(bytes, TRAILER_HEADER_BYTES, 'Trailer header');
  const L = TRAILER_LAYOUT;
  assertAllZero(
    bytes,
    L.padding.offset,
    L.padding.offset + L.padding.size,
    'Trailer padding',
  );
  const view = viewOf(bytes);
  const word = getU64Big(view, L.mutation.offset);
  const mutation = Number(word & 0xffn);
  if (!isMutationCode(mutation)) {
    throw new JournalFormatError(
      `Trailer mutation ${mutation} is not a known mutation`,
    );
  }
  const offsetAt = (name: keyof typeof L): number =>
    getU64(view, L[name].offset, name);
  const labelAt = (name: keyof typeof L): bigint =>
    getU64Big(view, L[name].offset);
  const hop = (index: number): number =>
    getU64(view, L.skip.offset + 8 * index, 'skip');
  return {
    selfOffset: offsetAt('selfOffset'),
    commitSeq: offsetAt('commitSeq'),
    parent: offsetAt('parent'),
    skip: [hop(0), hop(1), hop(2)],
    lineage: labelAt('lineage'),
    lineageDepth: offsetAt('lineageDepth'),
    mutation,
    groupTag: word >> 8n,
    mutationArg0: labelAt('mutationArg0'),
    mutationArg1: labelAt('mutationArg1'),
    rowRoot: offsetAt('rowRoot'),
    idRoot: offsetAt('idRoot'),
    metaRoot: offsetAt('metaRoot'),
    stateRoot: offsetAt('stateRoot'),
    nextLabel: labelAt('nextLabel'),
    firstLabel: labelAt('firstLabel'),
    lastRowOffset: offsetAt('lastRowOffset'),
    lastOwner: view.getUint32(L.lastOwner.offset, true),
    ckptBytes: offsetAt('ckptBytes'),
    rootAggregate: decodeAggregate(bytes, L.rootAggregate.offset),
    slots: decodeSlotTable(bytes, L.slots.offset),
    durableEnd: offsetAt('durableEnd'),
    syncMarker: bytes.slice(
      L.syncMarker.offset,
      L.syncMarker.offset + SYNC_MARKER_BYTES,
    ),
  };
}

/** The whole 1,500-byte record: frame head, kind header, and the CRC of an empty body. */
export function encodeTrailerRecord(trailer: TrailerHeader): Uint8Array {
  if (trailer.durableEnd !== trailer.selfOffset + TRAILER_RECORD_BYTES) {
    throw new JournalFormatError(
      `Trailer durableEnd ${trailer.durableEnd} is not selfOffset ${trailer.selfOffset} plus ${TRAILER_RECORD_BYTES}`,
    );
  }
  const start = encodeFrameStart(
    RECORD_KIND.TRAILER,
    encodeTrailerHeader(trailer),
    null,
  );
  const record = new Uint8Array(TRAILER_RECORD_BYTES);
  record.set(start, 0);
  return record;
}

export interface TrailerRecordExpectation {
  /** Where the record starts in the file. */
  readonly offset: number;
  /** The file's marker from its header. */
  readonly syncMarker: Uint8Array;
}

/**
 * Validates one candidate trailer record (design 3.1): the frame, the kind,
 * the self offset, the durable end and the closing sync marker. A frame
 * failure is a `JournalFrameError`; a record that is intact but not a trailer
 * of this file at this offset is a `JournalFormatError`.
 */
export function decodeTrailerRecord(
  record: Uint8Array,
  expected: TrailerRecordExpectation,
): TrailerHeader {
  assertLength(record, TRAILER_RECORD_BYTES, 'Trailer record');
  const frame = decodeFrameStart(record, expected.offset);
  if (
    frame.kind !== RECORD_KIND.TRAILER ||
    frame.headerLen !== TRAILER_HEADER_BYTES ||
    frame.bodyLen !== 0
  ) {
    throw new JournalFormatError(
      `Record at offset ${expected.offset} is not a trailer frame (kind ${frame.kind}, header ${frame.headerLen}, body ${frame.bodyLen})`,
    );
  }
  const storedBodyCrc = viewOf(record).getUint32(
    TRAILER_RECORD_BYTES - BODY_CRC_BYTES,
    true,
  );
  if (storedBodyCrc !== 0) {
    throw new JournalFrameError(
      'body-crc-mismatch',
      expected.offset,
      `trailer body CRC ${storedBodyCrc.toString(16)} is not the CRC of an empty body`,
    );
  }
  const trailer = decodeTrailerHeader(frame.kindHeader);
  assertTrailerPlacement(trailer, expected);
  return trailer;
}

function assertTrailerPlacement(
  trailer: TrailerHeader,
  expected: TrailerRecordExpectation,
): void {
  if (trailer.selfOffset !== expected.offset) {
    throw new JournalFormatError(
      `Trailer selfOffset ${trailer.selfOffset} does not match its position ${expected.offset}`,
    );
  }
  if (trailer.durableEnd !== expected.offset + TRAILER_RECORD_BYTES) {
    throw new JournalFormatError(
      `Trailer durableEnd ${trailer.durableEnd} is not the end of the record at ${expected.offset}`,
    );
  }
  if (!bytesEqual(trailer.syncMarker, expected.syncMarker)) {
    throw new JournalFormatError(
      `Trailer at offset ${expected.offset} ends with a syncMarker that is not the file's`,
    );
  }
}
