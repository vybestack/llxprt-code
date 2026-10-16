/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  JournalCorruptionError,
  JournalFrameError,
  JournalTrailerCandidateError,
} from './errors.js';
import { JOURNAL_HEADER_BYTES, type JournalHeader } from './fileHeader.js';
import { readJournalHeaderOrRefuse } from './journalRefusal.js';
import type { PositionalReader } from './positionalFile.js';
import { RECORD_KIND } from './recordKinds.js';
import { createRecordAccess } from './recordAccess.js';
import {
  TRAILER_RECORD_BYTES,
  decodeTrailerRecord,
  type TrailerHeader,
} from './trailerRecord.js';

/** The first read from the end of the file (design 3.1 step 1). */
export const TRAILER_WINDOW_BYTES = 64 * 1024;
/** Each later step backward (design 3.1 step 4). */
export const TRAILER_CHUNK_BYTES = 4 * 1024 * 1024;
/** A trailer ends 12 bytes after its marker starts: marker (8) and body CRC (4). */
export const CHUNK_OVERLAP_BYTES = 12;

const MARKER_BYTES = 8;

/**
 * Trailer candidates, newest first: every place a `syncMarker` ends a record
 * that is a structurally valid trailer of this file (design 3.1 step 3). A
 * candidate that is cut off, fails its frame CRC, is not a trailer, or sits
 * somewhere other than the offset it names is a torn tail or a quoted marker
 * and is passed over. A frame that passed its CRC and still fails to decode is
 * a writer bug and throws.
 */
export async function* structuralTrailers(
  reader: PositionalReader,
  fileSize: number,
  syncMarker: Uint8Array,
): AsyncGenerator<TrailerHeader> {
  let hi = fileSize;
  let step = TRAILER_WINDOW_BYTES;
  while (hi > JOURNAL_HEADER_BYTES) {
    const lo = Math.max(JOURNAL_HEADER_BYTES, hi - step);
    yield* trailersEndingInChunk(reader, fileSize, syncMarker, lo, hi);
    hi = lo;
    step = TRAILER_CHUNK_BYTES;
  }
}

/** Markers that start in `[lo, hi)`, read with `CHUNK_OVERLAP_BYTES` beyond `hi` so none is cut. */
async function* trailersEndingInChunk(
  reader: PositionalReader,
  fileSize: number,
  syncMarker: Uint8Array,
  lo: number,
  hi: number,
): AsyncGenerator<TrailerHeader> {
  const readEnd = Math.min(hi + CHUNK_OVERLAP_BYTES, fileSize);
  const bytes = await reader.readAt(lo, readEnd - lo);
  // The Buffer view is only for `lastIndexOf`; records are cut from `bytes`, whose `slice` copies.
  const chunk = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let from = chunk.length - MARKER_BYTES;
  while (from >= 0) {
    const index = chunk.lastIndexOf(syncMarker, from);
    if (index < 0) return;
    from = index - 1;
    if (lo + index >= hi) continue;
    const trailer = await decodeCandidate(
      reader,
      fileSize,
      syncMarker,
      lo + index + CHUNK_OVERLAP_BYTES,
      { lo, bytes },
    );
    if (trailer !== undefined) yield trailer;
  }
}

async function decodeCandidate(
  reader: PositionalReader,
  fileSize: number,
  syncMarker: Uint8Array,
  end: number,
  window: { readonly lo: number; readonly bytes: Uint8Array },
): Promise<TrailerHeader | undefined> {
  const start = end - TRAILER_RECORD_BYTES;
  if (start < JOURNAL_HEADER_BYTES || end > fileSize) return undefined;
  const record =
    start >= window.lo
      ? window.bytes.subarray(start - window.lo, end - window.lo)
      : await reader.readAt(start, TRAILER_RECORD_BYTES);
  try {
    return decodeTrailerRecord(record, { offset: start, syncMarker });
  } catch (error) {
    if (
      error instanceof JournalFrameError ||
      error instanceof JournalTrailerCandidateError
    ) {
      return undefined;
    }
    throw error;
  }
}

const ROOT_KINDS = [
  ['rowRoot', RECORD_KIND.RTNODE],
  ['idRoot', RECORD_KIND.ITNODE],
  ['metaRoot', RECORD_KIND.ITNODE],
  ['stateRoot', RECORD_KIND.ITNODE],
] as const;

async function drain(chunks: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = chunks[Symbol.asyncIterator]();
  let step = await iterator.next();
  while (step.done !== true) {
    // The iteration checks the body CRC after its last chunk.
    step = await iterator.next();
  }
}

/**
 * Reads the roots of an intact trailer back, each when non-zero, with their
 * CRCs checked (design 3.1 step 3). A root that is missing, past the end, of
 * the wrong kind or fails a CRC is corruption: the trailer that names it is
 * intact, so an older trailer is never an answer.
 */
export async function verifyTrailerRoots(
  path: string,
  reader: PositionalReader,
  trailer: TrailerHeader,
): Promise<void> {
  const access = createRecordAccess(path, reader, trailer);
  for (const [name, kind] of ROOT_KINDS) {
    const offset = trailer[name];
    if (offset === 0) continue;
    const damaged = (detail: string): JournalCorruptionError =>
      new JournalCorruptionError(
        path,
        name,
        offset,
        trailer.selfOffset,
        detail,
      );
    if (offset < JOURNAL_HEADER_BYTES) {
      throw damaged('the root lies inside the file header');
    }
    const head = await access.readRecordHead(offset, name);
    if (head.kind !== kind || head.endOffset > trailer.selfOffset) {
      throw damaged(
        `the root is a record of kind ${head.kind} ending at ${head.endOffset}, not a ${kind} record written before the trailer`,
      );
    }
    await drain(access.readRecordBody(head, undefined, name));
  }
}

/** The newest structurally valid trailer with readable roots, or none for a journal with no group yet. */
export async function findLastTrailer(
  path: string,
  reader: PositionalReader,
  fileSize: number,
  syncMarker: Uint8Array,
): Promise<TrailerHeader | undefined> {
  for await (const trailer of structuralTrailers(
    reader,
    fileSize,
    syncMarker,
  )) {
    await verifyTrailerRoots(path, reader, trailer);
    return trailer;
  }
  return undefined;
}

export interface CommittedState {
  readonly header: JournalHeader;
  /** Undefined when the journal holds no committed group yet. */
  readonly trailer: TrailerHeader | undefined;
}

/**
 * The state every opener starts from: the refusal test on the first bytes,
 * then the last trailer. Nothing is written.
 */
export async function locateCommittedState(
  path: string,
  reader: PositionalReader,
  fileSize: number,
): Promise<CommittedState> {
  const header = await readJournalHeaderOrRefuse(path, reader, fileSize);
  const trailer = await findLastTrailer(
    path,
    reader,
    fileSize,
    header.syncMarker,
  );
  return { header, trailer };
}
