/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertAllZero,
  crc32,
  putU8,
  putU32,
  putU64,
  span,
  viewOf,
} from './bytes.js';
import { JournalFormatError, JournalFrameError } from './errors.js';
import type { ByteSink, PositionalReader } from './positionalFile.js';

/** Design 2.2 and 2.7: the 20-byte head, every field at its natural alignment. */
export const FRAME_HEAD_BYTES = 20;
export const BODY_CRC_BYTES = 4;
export const FRAME_FLAG_BODY = 0x01;
const FRAME_CRC_COVERS_BYTES = 16;
export const FRAME_HEAD_LAYOUT = {
  kind: span(0, 1),
  frameFlags: span(1, 1),
  reserved: span(2, 2),
  headerLen: span(4, 4),
  bodyLen: span(8, 8),
  frameCrc: span(16, 4),
};
const DEFAULT_BODY_CHUNK_BYTES = 1024 * 1024;

/** A validated frame head. The body is not read and has no upper bound. */
export interface FrameHead {
  readonly offset: number;
  readonly kind: number;
  readonly frameFlags: number;
  readonly headerLen: number;
  readonly bodyLen: number;
  readonly kindHeader: Uint8Array;
  readonly bodyOffset: number;
  /** Offset just past the body CRC. */
  readonly endOffset: number;
}

export interface FrameBody {
  /** Declared up front because the frame head carries it. */
  readonly length: number;
  readonly chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
}

interface RawFrameHead {
  readonly kind: number;
  readonly frameFlags: number;
  readonly headerLen: number;
  readonly bodyLen: bigint;
  readonly frameCrc: number;
}

/** `20 + headerLen + bodyLen + 4`. */
export function frameLength(headerLen: number, bodyLen: number): number {
  return FRAME_HEAD_BYTES + headerLen + bodyLen + BODY_CRC_BYTES;
}

/** Fills the 20-byte head and the kind header at the start of `bytes`. */
function fillFrameStart(
  bytes: Uint8Array,
  kind: number,
  kindHeader: Uint8Array,
  bodyLen: number | null,
): void {
  const view = viewOf(bytes);
  const L = FRAME_HEAD_LAYOUT;
  putU8(view, L.kind.offset, 'kind', kind);
  putU8(
    view,
    L.frameFlags.offset,
    'frameFlags',
    bodyLen === null ? 0 : FRAME_FLAG_BODY,
  );
  putU32(view, L.headerLen.offset, 'headerLen', kindHeader.length);
  putU64(view, L.bodyLen.offset, 'bodyLen', bodyLen ?? 0);
  bytes.set(kindHeader, FRAME_HEAD_BYTES);
  const frameCrc = crc32(
    kindHeader,
    crc32(bytes.subarray(0, FRAME_CRC_COVERS_BYTES)),
  );
  putU32(view, L.frameCrc.offset, 'frameCrc', frameCrc);
}

/** The 20-byte head followed by the kind header; `null` means the frame has no body. */
export function encodeFrameStart(
  kind: number,
  kindHeader: Uint8Array,
  bodyLen: number | null,
): Uint8Array {
  const bytes = new Uint8Array(FRAME_HEAD_BYTES + kindHeader.length);
  fillFrameStart(bytes, kind, kindHeader, bodyLen);
  return bytes;
}

/**
 * A whole frame that has no body, in one buffer: the head, the kind header and
 * the body CRC of an empty body, which is zero.
 */
export function encodeBodylessFrame(
  kind: number,
  kindHeader: Uint8Array,
): Uint8Array {
  const bytes = new Uint8Array(frameLength(kindHeader.length, 0));
  fillFrameStart(bytes, kind, kindHeader, null);
  return bytes;
}

function parseRawHead(head: Uint8Array): RawFrameHead {
  const view = viewOf(head);
  const L = FRAME_HEAD_LAYOUT;
  return {
    kind: view.getUint8(L.kind.offset),
    frameFlags: view.getUint8(L.frameFlags.offset),
    headerLen: view.getUint32(L.headerLen.offset, true),
    bodyLen: view.getBigUint64(L.bodyLen.offset, true),
    frameCrc: view.getUint32(L.frameCrc.offset, true),
  };
}

function totalLength(raw: RawFrameHead): bigint {
  return (
    BigInt(FRAME_HEAD_BYTES + BODY_CRC_BYTES) +
    BigInt(raw.headerLen) +
    raw.bodyLen
  );
}

function assertFrameCrc(
  offset: number,
  head: Uint8Array,
  raw: RawFrameHead,
  kindHeader: Uint8Array,
): void {
  const actual = crc32(
    kindHeader,
    crc32(head.subarray(0, FRAME_CRC_COVERS_BYTES)),
  );
  if (actual !== raw.frameCrc) {
    throw new JournalFrameError(
      'frame-crc-mismatch',
      offset,
      `frame CRC ${raw.frameCrc.toString(16)} does not match ${actual.toString(16)}`,
    );
  }
}

/** Checks that run only after the frame CRC has passed, so a failure here is a writer bug. */
function buildHead(
  offset: number,
  head: Uint8Array,
  raw: RawFrameHead,
  kindHeader: Uint8Array,
): FrameHead {
  const reserved = FRAME_HEAD_LAYOUT.reserved;
  assertAllZero(
    head,
    reserved.offset,
    reserved.offset + reserved.size,
    `Journal frame head reserved bytes at offset ${offset}`,
  );
  const hasBodyFlag = (raw.frameFlags & FRAME_FLAG_BODY) !== 0;
  if ((raw.frameFlags & ~FRAME_FLAG_BODY) !== 0) {
    throw new JournalFormatError(
      `Journal frame at offset ${offset} has unknown frame flags ${raw.frameFlags}`,
    );
  }
  if (!hasBodyFlag && raw.bodyLen !== 0n) {
    throw new JournalFormatError(
      `Journal frame at offset ${offset} has a body of ${raw.bodyLen} bytes but no body flag`,
    );
  }
  const bodyLen = Number(raw.bodyLen);
  const bodyOffset = offset + FRAME_HEAD_BYTES + raw.headerLen;
  return {
    offset,
    kind: raw.kind,
    frameFlags: raw.frameFlags,
    headerLen: raw.headerLen,
    bodyLen,
    kindHeader,
    bodyOffset,
    endOffset: bodyOffset + bodyLen + BODY_CRC_BYTES,
  };
}

function doesNotFit(offset: number, detail: string): JournalFrameError {
  return new JournalFrameError('does-not-fit', offset, detail);
}

/**
 * Validates the frame at the start of `bytes`, an in-memory record whose first
 * byte is at file offset `offset`.
 */
export function decodeFrameStart(bytes: Uint8Array, offset: number): FrameHead {
  if (bytes.length < FRAME_HEAD_BYTES) {
    throw doesNotFit(
      offset,
      `only ${bytes.length} bytes for a ${FRAME_HEAD_BYTES}-byte head`,
    );
  }
  const head = bytes.subarray(0, FRAME_HEAD_BYTES);
  const raw = parseRawHead(head);
  if (totalLength(raw) > BigInt(bytes.length)) {
    throw doesNotFit(
      offset,
      `frame of ${totalLength(raw)} bytes exceeds ${bytes.length}`,
    );
  }
  const kindHeader = bytes.slice(
    FRAME_HEAD_BYTES,
    FRAME_HEAD_BYTES + raw.headerLen,
  );
  assertFrameCrc(offset, head, raw, kindHeader);
  return buildHead(offset, head, raw, kindHeader);
}

/** A validated head with the bytes that followed the kind header in the same read. */
export interface FrameStart {
  readonly head: FrameHead;
  /**
   * Body bytes that arrived with the head, at most the prefetch size and at
   * most the body. They are not covered by the body CRC check, so only a
   * caller that accepts that (design 4.6: a rebuild reads a row's id piece
   * and never its blocks) may use them.
   */
  readonly bodyPrefix: Uint8Array;
}

/**
 * Reads the head and kind header of the frame at `offset`, in the order of
 * design 2.2: the frame fits in the file, then the frame CRC matches.
 * `does-not-fit` and `frame-crc-mismatch` are a torn write, tolerated only at
 * the tail of the file. A caller that knows how big the head and kind header
 * usually are passes `prefetchBytes`, and the head is then read together with
 * the kind header in one read (clipped to the end of the file); a kind header
 * larger than that is read with a second one.
 */
export async function readFrameStart(
  reader: PositionalReader,
  offset: number,
  fileSize: number,
  prefetchBytes: number = FRAME_HEAD_BYTES,
): Promise<FrameStart> {
  if (offset + FRAME_HEAD_BYTES > fileSize) {
    throw doesNotFit(offset, `file ends at ${fileSize}`);
  }
  const first = await reader.readAt(
    offset,
    Math.min(Math.max(prefetchBytes, FRAME_HEAD_BYTES), fileSize - offset),
  );
  const head = first.subarray(0, FRAME_HEAD_BYTES);
  const raw = parseRawHead(head);
  if (BigInt(offset) + totalLength(raw) > BigInt(fileSize)) {
    throw doesNotFit(
      offset,
      `frame of ${totalLength(raw)} bytes runs past file end ${fileSize}`,
    );
  }
  const kindHeaderEnd = FRAME_HEAD_BYTES + raw.headerLen;
  const inFirstRead = kindHeaderEnd <= first.length;
  const kindHeader = inFirstRead
    ? first.slice(FRAME_HEAD_BYTES, kindHeaderEnd)
    : new Uint8Array(raw.headerLen);
  if (!inFirstRead) {
    kindHeader.set(first.subarray(FRAME_HEAD_BYTES));
    kindHeader.set(
      await reader.readAt(offset + first.length, kindHeaderEnd - first.length),
      first.length - FRAME_HEAD_BYTES,
    );
  }
  assertFrameCrc(offset, head, raw, kindHeader);
  const bodyEnd = Math.min(first.length, kindHeaderEnd + Number(raw.bodyLen));
  return {
    head: buildHead(offset, head, raw, kindHeader),
    bodyPrefix: inFirstRead
      ? first.slice(kindHeaderEnd, bodyEnd)
      : new Uint8Array(0),
  };
}

export async function readFrameHead(
  reader: PositionalReader,
  offset: number,
  fileSize: number,
  prefetchBytes: number = FRAME_HEAD_BYTES,
): Promise<FrameHead> {
  return (await readFrameStart(reader, offset, fileSize, prefetchBytes)).head;
}

/**
 * The parts of one frame in write order: the head with the kind header, each
 * body chunk, and the body CRC. The body is consumed chunk by chunk and its
 * CRC is folded as it passes. A body that does not match its declared length
 * fails before the CRC part is produced.
 */
export async function* frameParts(
  kind: number,
  kindHeader: Uint8Array,
  body?: FrameBody,
): AsyncGenerator<Uint8Array> {
  yield encodeFrameStart(
    kind,
    kindHeader,
    body === undefined ? null : body.length,
  );
  let crc = 0;
  if (body !== undefined) {
    let bytes = 0;
    for await (const chunk of body.chunks) {
      if (bytes + chunk.length > body.length) {
        throw new JournalFormatError(
          `Frame body is longer than its declared ${body.length} bytes`,
        );
      }
      crc = crc32(chunk, crc);
      bytes += chunk.length;
      yield chunk;
    }
    if (bytes !== body.length) {
      throw new JournalFormatError(
        `Frame body is shorter than its declared ${body.length} bytes: got ${bytes}`,
      );
    }
  }
  const trailer = new Uint8Array(BODY_CRC_BYTES);
  putU32(viewOf(trailer), 0, 'bodyCrc', crc);
  yield trailer;
}

/**
 * Writes one frame and returns the number of bytes written. No more than one
 * body chunk is held.
 */
export async function writeFrame(
  sink: ByteSink,
  kind: number,
  kindHeader: Uint8Array,
  body?: FrameBody,
): Promise<number> {
  let written = 0;
  for await (const part of frameParts(kind, kindHeader, body)) {
    await sink(part);
    written += part.length;
  }
  return written;
}

/**
 * Streams the body in chunks of at most `chunkBytes`, folding the CRC as it
 * goes, and checks the stored body CRC after the last chunk. Chunks reach the
 * consumer before that check, so the consumer must not treat the body as valid
 * until the iteration has completed without throwing.
 */
export async function* readFrameBody(
  reader: PositionalReader,
  head: FrameHead,
  chunkBytes: number = DEFAULT_BODY_CHUNK_BYTES,
): AsyncGenerator<Uint8Array> {
  let crc = 0;
  let position = 0;
  while (position < head.bodyLen) {
    const size = Math.min(chunkBytes, head.bodyLen - position);
    const chunk = await reader.readAt(head.bodyOffset + position, size);
    crc = crc32(chunk, crc);
    position += size;
    yield chunk;
  }
  const stored = viewOf(
    await reader.readAt(head.bodyOffset + head.bodyLen, BODY_CRC_BYTES),
  ).getUint32(0, true);
  if (stored !== crc) {
    throw new JournalFrameError(
      'body-crc-mismatch',
      head.offset,
      `body CRC ${stored.toString(16)} does not match ${crc.toString(16)}`,
    );
  }
}
