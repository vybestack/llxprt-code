/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertAllZero,
  assertLength,
  getU64,
  getU64Big,
  putU8,
  putU16,
  putU32,
  putU64,
  putU64Big,
  span,
  viewOf,
  type Quad,
  type Triple,
} from './bytes.js';
import type { SlotStamp } from './aggregate.js';
import { JournalFormatError } from './errors.js';
import { SLOT_SUMMARY_BYTES } from './slotSummary.js';
import { ROW_SPEAKER } from './rowRecord.js';

/** A leaf entry of the row tree at format version 3 (design 3.2). */
export const ROW_ENTRY_BYTES = 1104;

/** Offsets inside one entry. The design gives the sizes of each group; the order follows its table. */
export const ROW_ENTRY_LAYOUT = {
  label: span(0, 8),
  recordOffset: span(8, 8),
  recordLength: span(16, 8),
  speaker: span(24, 1),
  flags: span(25, 2),
  reconBlocks: span(27, 2),
  answered: span(29, 2),
  pad: span(31, 1),
  chronologySeq: span(32, 8),
  chronologyUserTurn: span(40, 4),
  chronologyStep: span(44, 4),
  chronologyRecordedAt: span(48, 8),
  owner: span(56, 4),
  callBlocks: span(60, 2),
  unmappedBlocks: span(62, 2),
  lensRef: span(64, 24),
  summary: span(88, 888),
  media: span(976, 56),
  tokens: span(1032, 48),
  stamp: span(1080, 24),
};

/** The same marker the `ROW` record uses for a row without a chronology seq. */
export const ROW_ENTRY_NO_CHRONOLOGY_SEQ = 0xffff_ffff_ffff_ffffn;

/**
 * The entry `flags` are the row's flags (bits 0 to 10) plus the two derived
 * bits of the design: `pairSensitive` (7.3) and `imageContrib` (8.5).
 */
export const ENTRY_FLAG = {
  pairSensitive: 1 << 11,
  imageContrib: 1 << 12,
} as const;
const FLAGS_LIMIT = 1 << 13;

/** The entry's contribution to the media metrics (design 8.4), 56 bytes. */
export interface EntryMedia {
  readonly mediaChars: number;
  readonly imageChars: Triple<number>;
  readonly pdfBytes: Triple<number>;
}

export interface RowEntry {
  readonly label: bigint;
  readonly recordOffset: number;
  readonly recordLength: number;
  readonly speaker: number;
  readonly flags: number;
  readonly reconBlocks: number;
  readonly answered: number;
  readonly chronologySeq: bigint;
  readonly chronologyUserTurn: number;
  readonly chronologyStep: number;
  readonly chronologyRecordedAt: number;
  readonly owner: number;
  readonly callBlocks: number;
  readonly unmappedBlocks: number;
  readonly lensRef: Triple<number>;
  /** One slot summary per format slot; the slot table says which layout each holds. */
  readonly summary: Triple<Uint8Array>;
  readonly media: EntryMedia;
  /** Per vector (stripped self, reconstructed, adjacent response) and tokenizer slot. */
  readonly tokens: Triple<Quad<number>>;
  readonly stamp: Triple<SlotStamp>;
}

const L = ROW_ENTRY_LAYOUT;
const MEDIA_IMAGE_CHARS = 8;
const MEDIA_PDF_BYTES = 32;

function fail(message: string): never {
  throw new JournalFormatError(message);
}

function assertEntryFields(entry: RowEntry): void {
  if (entry.label < 1n) fail(`Entry label ${entry.label} must be at least 1`);
  if (entry.speaker > ROW_SPEAKER.tool) {
    fail(`Entry speaker ${entry.speaker} is not human, ai or tool`);
  }
  if (entry.flags >= FLAGS_LIMIT) {
    fail(`Entry flags ${entry.flags} use bits above the defined ones`);
  }
}

function encodeMedia(view: DataView, base: number, media: EntryMedia): void {
  putU64(view, base, 'mediaChars', media.mediaChars);
  media.imageChars.forEach((value, slot) =>
    putU64(view, base + MEDIA_IMAGE_CHARS + 8 * slot, 'imageChars', value),
  );
  media.pdfBytes.forEach((value, slot) =>
    putU64(view, base + MEDIA_PDF_BYTES + 8 * slot, 'pdfBytes', value),
  );
}

function encodeTokens(
  view: DataView,
  base: number,
  tokens: Triple<Quad<number>>,
): void {
  tokens.forEach((vector, at) =>
    vector.forEach((value, slot) =>
      putU32(view, base + 4 * (4 * at + slot), 'tokens', value),
    ),
  );
}

function encodeSummaries(
  target: Uint8Array,
  base: number,
  summaries: Triple<Uint8Array>,
): void {
  summaries.forEach((summary, slot) => {
    assertLength(summary, SLOT_SUMMARY_BYTES, `Entry summary slot ${slot}`);
    target.set(summary, base + SLOT_SUMMARY_BYTES * slot);
  });
}

/** Writes the entry into `target` at `offset`; the entry's bytes are all written, padding included. */
export function encodeRowEntryInto(
  target: Uint8Array,
  offset: number,
  entry: RowEntry,
): void {
  assertEntryFields(entry);
  const view = viewOf(target);
  const at = (name: keyof typeof ROW_ENTRY_LAYOUT): number =>
    offset + L[name].offset;
  putU64Big(view, at('label'), 'label', entry.label);
  putU64(view, at('recordOffset'), 'recordOffset', entry.recordOffset);
  putU64(view, at('recordLength'), 'recordLength', entry.recordLength);
  putU8(view, at('speaker'), 'speaker', entry.speaker);
  putU16(view, at('flags'), 'flags', entry.flags);
  putU16(view, at('reconBlocks'), 'reconBlocks', entry.reconBlocks);
  putU16(view, at('answered'), 'answered', entry.answered);
  putU64Big(view, at('chronologySeq'), 'chronologySeq', entry.chronologySeq);
  putU32(
    view,
    at('chronologyUserTurn'),
    'chronologyUserTurn',
    entry.chronologyUserTurn,
  );
  putU32(view, at('chronologyStep'), 'chronologyStep', entry.chronologyStep);
  putU64(
    view,
    at('chronologyRecordedAt'),
    'chronologyRecordedAt',
    entry.chronologyRecordedAt,
  );
  putU32(view, at('owner'), 'owner', entry.owner);
  putU16(view, at('callBlocks'), 'callBlocks', entry.callBlocks);
  putU16(view, at('unmappedBlocks'), 'unmappedBlocks', entry.unmappedBlocks);
  entry.lensRef.forEach((ref, slot) =>
    putU64(view, at('lensRef') + 8 * slot, 'lensRef', ref),
  );
  encodeSummaries(target, at('summary'), entry.summary);
  encodeMedia(view, at('media'), entry.media);
  encodeTokens(view, at('tokens'), entry.tokens);
  entry.stamp.forEach((stamp, slot) => {
    putU32(view, at('stamp') + 8 * slot, 'stamp gen', stamp.gen);
    putU32(view, at('stamp') + 8 * slot + 4, 'stamp imageGen', stamp.imageGen);
  });
}

function decodeMedia(view: DataView, base: number): EntryMedia {
  const triple = (start: number, name: string): Triple<number> => [
    getU64(view, start, name),
    getU64(view, start + 8, name),
    getU64(view, start + 16, name),
  ];
  return {
    mediaChars: getU64(view, base, 'mediaChars'),
    imageChars: triple(base + MEDIA_IMAGE_CHARS, 'imageChars'),
    pdfBytes: triple(base + MEDIA_PDF_BYTES, 'pdfBytes'),
  };
}

function decodeTokens(view: DataView, base: number): Triple<Quad<number>> {
  const vector = (at: number): Quad<number> => [
    view.getUint32(base + 16 * at, true),
    view.getUint32(base + 16 * at + 4, true),
    view.getUint32(base + 16 * at + 8, true),
    view.getUint32(base + 16 * at + 12, true),
  ];
  return [vector(0), vector(1), vector(2)];
}

function decodeStamp(view: DataView, base: number): SlotStamp {
  return {
    gen: view.getUint32(base, true),
    imageGen: view.getUint32(base + 4, true),
  };
}

export function decodeRowEntry(source: Uint8Array, offset: number): RowEntry {
  if (source.length < offset + ROW_ENTRY_BYTES) {
    fail(
      `Row entry needs ${ROW_ENTRY_BYTES} bytes at ${offset}, only ${source.length - offset} available`,
    );
  }
  assertAllZero(
    source,
    offset + L.pad.offset,
    offset + L.pad.offset + L.pad.size,
    'Row entry padding',
  );
  const view = viewOf(source);
  const at = (name: keyof typeof ROW_ENTRY_LAYOUT): number =>
    offset + L[name].offset;
  // Views of `source`: a node decodes from a buffer it read for itself, and an
  // entry that outlives the node keeps only that buffer alive.
  const summary = (slot: number): Uint8Array => {
    const start = at('summary') + SLOT_SUMMARY_BYTES * slot;
    return source.subarray(start, start + SLOT_SUMMARY_BYTES);
  };
  const stamp = at('stamp');
  const entry: RowEntry = {
    label: getU64Big(view, at('label')),
    recordOffset: getU64(view, at('recordOffset'), 'recordOffset'),
    recordLength: getU64(view, at('recordLength'), 'recordLength'),
    speaker: view.getUint8(at('speaker')),
    flags: view.getUint16(at('flags'), true),
    reconBlocks: view.getUint16(at('reconBlocks'), true),
    answered: view.getUint16(at('answered'), true),
    chronologySeq: getU64Big(view, at('chronologySeq')),
    chronologyUserTurn: view.getUint32(at('chronologyUserTurn'), true),
    chronologyStep: view.getUint32(at('chronologyStep'), true),
    chronologyRecordedAt: getU64(
      view,
      at('chronologyRecordedAt'),
      'chronologyRecordedAt',
    ),
    owner: view.getUint32(at('owner'), true),
    callBlocks: view.getUint16(at('callBlocks'), true),
    unmappedBlocks: view.getUint16(at('unmappedBlocks'), true),
    lensRef: [
      getU64(view, at('lensRef'), 'lensRef'),
      getU64(view, at('lensRef') + 8, 'lensRef'),
      getU64(view, at('lensRef') + 16, 'lensRef'),
    ],
    summary: [summary(0), summary(1), summary(2)],
    media: decodeMedia(view, at('media')),
    tokens: decodeTokens(view, at('tokens')),
    stamp: [
      decodeStamp(view, stamp),
      decodeStamp(view, stamp + 8),
      decodeStamp(view, stamp + 16),
    ],
  };
  assertEntryFields(entry);
  return entry;
}
