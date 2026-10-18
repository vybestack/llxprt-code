/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, type Hash } from 'node:crypto';
import { open, stat, type FileHandle } from 'node:fs/promises';
import { JOURNAL_HEADER_BYTES } from '../journal/fileHeader.js';
import { sha256KeyHash } from '../journal/idKeys.js';
import {
  openJournalReadOnly,
  type JournalReader,
} from '../journal/journalReader.js';
import { stateReaderOf } from '../journal/journalReaderState.js';
import { RECORD_KIND } from '../journal/recordKinds.js';
import { decodeIdPiece, decodeRowHeader } from '../journal/rowRecord.js';
import { FRAME_HEAD_BYTES, type FrameHead } from '../journal/frame.js';
import { crc32 } from '../journal/bytes.js';
import {
  createRecordAccess,
  type RecordAccess,
} from '../journal/recordAccess.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import { readSessionFacts } from './sessionMetaKeys.js';
import {
  boundedReadChanged,
  HASH_CHUNK_BYTES,
  type PinnedPackageFile,
} from './session-media-package-validation.js';

async function scanRow(
  reader: JournalReader,
  head: FrameHead,
  hash: Hash,
): Promise<IContent> {
  const header = decodeRowHeader(head.kindHeader);
  const singleChunk = head.bodyLen <= HASH_CHUNK_BYTES;
  let body: Uint8Array = singleChunk
    ? new Uint8Array(0)
    : Buffer.allocUnsafe(head.bodyLen);
  let offset = 0;
  for await (const chunk of hashBody(reader, head, hash)) {
    if (singleChunk) body = chunk;
    else body.set(chunk, offset);
    offset += chunk.length;
  }
  const content = decodeStoredRow({
    header,
    rawIds: decodeIdPiece(body.subarray(0, header.idsLen), header.ids.length),
    meta: body.subarray(header.idsLen, header.idsLen + header.metaLen),
    blocks: header.blocks.map((block) =>
      body.subarray(block.offset, block.offset + block.length),
    ),
  });
  return content;
}

async function* hashBody(
  reader: JournalReader,
  head: FrameHead,
  hash: Hash,
): AsyncGenerator<Uint8Array> {
  let checksum = 0;
  for await (const chunk of reader.readRecordBody(head, HASH_CHUNK_BYTES)) {
    hash.update(chunk);
    checksum = crc32(chunk, checksum);
    yield chunk;
  }
  const crc = Buffer.alloc(4);
  crc.writeUInt32LE(checksum);
  hash.update(crc);
}

interface PackageScanAccess {
  readonly records: RecordAccess;
  readonly frameHead: Uint8Array;
  readHead(offset: number): Promise<FrameHead>;
}

function createPackageScanAccess(
  reader: JournalReader,
  handle: FileHandle,
): PackageScanAccess {
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const frameHead = new Uint8Array(FRAME_HEAD_BYTES);
  const bodyCrc = new Uint8Array(4);
  let headOffset = -1;
  if (reader.trailer === undefined)
    throw new Error('Packaged journal has no trailer');
  function readBuffer(position: number, length: number): Uint8Array {
    if (position === headOffset) return frameHead;
    if (length === 4) return bodyCrc;
    if (length <= buffer.length) return buffer.subarray(0, length);
    return new Uint8Array(length);
  }
  const records = createRecordAccess(
    reader.path,
    {
      async readAt(position: number, length: number): Promise<Uint8Array> {
        const target = readBuffer(position, length);
        let filled = 0;
        while (filled < length) {
          const { bytesRead } = await handle.read(
            target,
            filled,
            length - filled,
            position + filled,
          );
          if (bytesRead === 0)
            throw new Error('Packaged journal was truncated during validation');
          filled += bytesRead;
        }
        return target;
      },
    },
    reader.trailer,
  );
  return {
    records,
    frameHead,
    readHead: async (offset: number): Promise<FrameHead> => {
      headOffset = offset;
      return records.readRecordHead(offset);
    },
  };
}

async function scanFrames(
  reader: JournalReader,
  hash: Hash,
  onContents: (contents: readonly IContent[]) => void,
  handle: FileHandle,
): Promise<void> {
  const bodies = createPackageScanAccess(reader, handle);
  const scanReader: JournalReader = { ...reader, ...bodies.records };
  let offset = JOURNAL_HEADER_BYTES;
  while (offset < reader.fileSize) {
    const head = await bodies.readHead(offset);
    hash.update(bodies.frameHead);
    hash.update(head.kindHeader);
    if (head.kind === RECORD_KIND.ROW) {
      onContents([await scanRow(scanReader, head, hash)]);
    } else {
      for await (const chunk of hashBody(scanReader, head, hash)) {
        void chunk;
      }
    }
    offset = head.endOffset;
  }
}

export async function scanJournalRecording(
  path: string,
  onContents: (contents: readonly IContent[]) => void,
): Promise<PinnedPackageFile> {
  const before = await stat(path);
  const reader = await openJournalReadOnly(path);
  try {
    if (
      reader.trailer === undefined ||
      reader.trailer.durableEnd !== reader.fileSize
    ) {
      throw new Error(
        'Packaged journal is truncated or has an uncommitted tail',
      );
    }
    if (
      (await readSessionFacts(stateReaderOf(reader, sha256KeyHash))) ===
      undefined
    ) {
      throw new Error('Packaged journal holds no committed session');
    }
    const hash = createHash('sha256');
    const header = await open(path, 'r');
    try {
      const bytes = Buffer.alloc(JOURNAL_HEADER_BYTES);
      const { bytesRead } = await header.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== bytes.length)
        throw new Error('Truncated journal header');
      hash.update(bytes);
      await scanFrames(reader, hash, onContents, header);
    } finally {
      await header.close();
    }
    const after = await stat(path);
    if (boundedReadChanged(before, after, after, reader.fileSize))
      throw new Error('Packaged journal changed during validation');
    return { path, byteLength: reader.fileSize, sha256: hash.digest('hex') };
  } finally {
    await reader.close();
  }
}
