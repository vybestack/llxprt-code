/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { GroupRecord, RecordAppender } from './groupAppender.js';
import {
  decodeFrameStart,
  encodeBodylessFrame,
  frameLength,
  frameParts,
  readFrameBody,
  type FrameHead,
} from './frame.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import { JournalFormatError } from './errors.js';

const MAX_RECORD_BYTES = 4096;

function cacheable(record: GroupRecord): boolean {
  if (
    frameLength(record.kindHeader.length, record.body?.length ?? 0) >
    MAX_RECORD_BYTES
  )
    return false;
  if (record.body === undefined) return true;
  const chunks: unknown = record.body.chunks;
  return (
    record.kind === RECORD_KIND.VALUE &&
    Array.isArray(chunks) &&
    chunks.length === 1 &&
    chunks[0] instanceof Uint8Array
  );
}

/** A pinned recorder reuses bounded metadata frames, never response pieces. */
export class ArrivalRecordCache {
  private readonly records = new BoundedIdNodeCache();

  appender(target: RecordAppender): RecordAppender {
    return {
      get nextOffset() {
        return target.nextOffset;
      },
      drain: () => target.drain(),
      append: async (record) => {
        const offset = await target.append(record);
        if (cacheable(record)) {
          const bytes = await encoded(record);
          this.records.put(offset, bytes);
        }
        return offset;
      },
    };
  }

  private frame(offset: number, end: number): Uint8Array | undefined {
    const bytes = this.records.get(offset);
    return bytes !== undefined && offset + bytes.length <= end
      ? bytes
      : undefined;
  }

  access(source: RecordAccess, end: number): RecordAccess {
    const frame = (offset: number): Uint8Array | undefined =>
      this.frame(offset, end);
    const bodyReader = (head: FrameHead, bytes: Uint8Array) => ({
      readAt: async (position: number, length: number): Promise<Uint8Array> =>
        bytes.slice(position - head.offset, position - head.offset + length),
    });
    return {
      ...source,
      readRecordHead: async (offset, ...args) => {
        const bytes = frame(offset);
        return bytes === undefined
          ? source.readRecordHead(offset, ...args)
          : decodeFrameStart(bytes, offset);
      },
      readRecordStart: async (offset, what, prefetchBytes) => {
        const bytes = frame(offset);
        if (bytes === undefined)
          return source.readRecordStart(offset, what, prefetchBytes);
        const head = decodeFrameStart(bytes, offset);
        const start = head.bodyOffset - offset;
        return {
          head,
          bodyPrefix: bytes.slice(
            start,
            Math.min(start + head.bodyLen, Math.max(start, prefetchBytes)),
          ),
        };
      },
      readRecordRange: async (head, offset, length) => {
        const bytes = frame(head.offset);
        if (bytes === undefined)
          return source.readRecordRange(head, offset, length);
        const invalidOffset = !Number.isSafeInteger(offset) || offset < 0;
        const invalidLength = !Number.isSafeInteger(length) || length < 0;
        if (invalidOffset || invalidLength || offset + length > head.bodyLen)
          throw new JournalFormatError('Record body range is out of bounds');
        return bodyReader(head, bytes).readAt(head.bodyOffset + offset, length);
      },
      async *readRecordBody(head, chunkBytes, what) {
        const bytes = frame(head.offset);
        if (bytes === undefined)
          yield* source.readRecordBody(head, chunkBytes, what);
        else yield* readFrameBody(bodyReader(head, bytes), head, chunkBytes);
      },
    };
  }
}

async function encoded(record: GroupRecord): Promise<Uint8Array> {
  if (record.body === undefined)
    return encodeBodylessFrame(record.kind, record.kindHeader);
  const bytes = new Uint8Array(
    frameLength(record.kindHeader.length, record.body.length),
  );
  let at = 0;
  for await (const part of frameParts(
    record.kind,
    record.kindHeader,
    record.body,
  )) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}
