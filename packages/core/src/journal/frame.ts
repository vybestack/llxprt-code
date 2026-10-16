/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { crc32, putU8, putU16, putU32, putU64, viewOf } from './bytes.js';
import { JournalFormatError, JournalFrameError } from './errors.js';
import type { ByteSink, PositionalReader } from './positionalFile.js';

export const FRAME_HEAD_BYTES = 16;
export const BODY_CRC_BYTES = 4;
const FRAME_FLAG_BODY = 0x01;
const FRAME_CRC_COVERS_BYTES = 12;
const MAX_KIND_HEADER_BYTES = 0xffff;
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

/** `16 + headerLen + bodyLen + 4`. */
export function frameLength(headerLen: number, bodyLen: number): number {
  return FRAME_HEAD_BYTES + headerLen + bodyLen + BODY_CRC_BYTES;
}

/** The 16-byte head followed by the kind header; `null` means the frame has no body. */
export function encodeFrameStart(
  kind: number,
  kindHeader: Uint8Array,
  bodyLen: number | null,
): Uint8Array {
  const bytes = new Uint8Array(FRAME_HEAD_BYTES + kindHeader.length);
  const view = viewOf(bytes);
  putU8(view, 0, 'kind', kind);
  putU8(view, 1, 'frameFlags', bodyLen === null ? 0 : FRAME_FLAG_BODY);
  putU16(view, 2, 'headerLen', kindHeader.length);
  putU64(view, 4, 'bodyLen', bodyLen ?? 0);
  bytes.set(kindHeader, FRAME_HEAD_BYTES);
  const frameCrc = crc32(
    kindHeader,
    crc32(bytes.subarray(0, FRAME_CRC_COVERS_BYTES)),
  );
  putU32(view, FRAME_CRC_COVERS_BYTES, 'frameCrc', frameCrc);
  return bytes;
}

function parseRawHead(head: Uint8Array): RawFrameHead {
  const view = viewOf(head);
  return {
    kind: view.getUint8(0),
    frameFlags: view.getUint8(1),
    headerLen: view.getUint16(2, true),
    bodyLen: view.getBigUint64(4, true),
    frameCrc: view.getUint32(FRAME_CRC_COVERS_BYTES, true),
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
  raw: RawFrameHead,
  kindHeader: Uint8Array,
): FrameHead {
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
    throw doesNotFit(offset, `only ${bytes.length} bytes for a 16-byte head`);
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
  return buildHead(offset, raw, kindHeader);
}

/**
 * Reads the head and kind header of the frame at `offset`, in the order of
 * design 2.2: the frame fits in the file, then the frame CRC matches.
 * `does-not-fit` and `frame-crc-mismatch` are a torn write, tolerated only at
 * the tail of the file.
 */
export async function readFrameHead(
  reader: PositionalReader,
  offset: number,
  fileSize: number,
): Promise<FrameHead> {
  if (offset + FRAME_HEAD_BYTES > fileSize) {
    throw doesNotFit(offset, `file ends at ${fileSize}`);
  }
  const head = await reader.readAt(offset, FRAME_HEAD_BYTES);
  const raw = parseRawHead(head);
  if (BigInt(offset) + totalLength(raw) > BigInt(fileSize)) {
    throw doesNotFit(
      offset,
      `frame of ${totalLength(raw)} bytes runs past file end ${fileSize}`,
    );
  }
  const kindHeader = await reader.readAt(
    offset + FRAME_HEAD_BYTES,
    raw.headerLen,
  );
  assertFrameCrc(offset, head, raw, kindHeader);
  return buildHead(offset, raw, kindHeader);
}

/**
 * Writes one frame and returns the number of bytes written. The body is
 * consumed chunk by chunk and its CRC is folded as it passes, so no more than
 * one chunk is held. A body that does not match its declared length fails
 * before the CRC is written.
 */
export async function writeFrame(
  sink: ByteSink,
  kind: number,
  kindHeader: Uint8Array,
  body?: FrameBody,
): Promise<number> {
  if (kindHeader.length > MAX_KIND_HEADER_BYTES) {
    throw new JournalFormatError(
      `Kind header of ${kindHeader.length} bytes exceeds the ${MAX_KIND_HEADER_BYTES} a frame can describe`,
    );
  }
  const start = encodeFrameStart(
    kind,
    kindHeader,
    body === undefined ? null : body.length,
  );
  await sink(start);
  const sent =
    body === undefined ? { bytes: 0, crc: 0 } : await writeBody(sink, body);
  const trailer = new Uint8Array(BODY_CRC_BYTES);
  putU32(viewOf(trailer), 0, 'bodyCrc', sent.crc);
  await sink(trailer);
  return start.length + sent.bytes + BODY_CRC_BYTES;
}

async function writeBody(
  sink: ByteSink,
  body: FrameBody,
): Promise<{ bytes: number; crc: number }> {
  let bytes = 0;
  let crc = 0;
  for await (const chunk of body.chunks) {
    if (bytes + chunk.length > body.length) {
      throw new JournalFormatError(
        `Frame body is longer than its declared ${body.length} bytes`,
      );
    }
    crc = crc32(chunk, crc);
    await sink(chunk);
    bytes += chunk.length;
  }
  if (bytes !== body.length) {
    throw new JournalFormatError(
      `Frame body is shorter than its declared ${body.length} bytes: got ${bytes}`,
    );
  }
  return { bytes, crc };
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
