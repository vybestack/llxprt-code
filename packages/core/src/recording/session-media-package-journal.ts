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
import {
  encodeFrameStart,
  FRAME_FLAG_BODY,
  type FrameHead,
} from '../journal/frame.js';
import { crc32 } from '../journal/bytes.js';
import { createFileHandleSink } from '../journal/positionalFile.js';
import { JournalSession } from '../services/history/journalSession.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import {
  SESSION_KEYS,
  encodeSessionFact,
  readSessionFacts,
} from './sessionMetaKeys.js';
import {
  boundedReadChanged,
  HASH_CHUNK_BYTES,
  requirePortableMediaContent,
  type PinnedPackageFile,
} from './session-media-package-validation.js';

async function scanRow(
  reader: JournalReader,
  head: FrameHead,
  hash: Hash,
): Promise<IContent> {
  const header = decodeRowHeader(head.kindHeader);
  const body = Buffer.allocUnsafe(head.bodyLen);
  let offset = 0;
  for await (const chunk of hashBody(reader, head, hash)) {
    body.set(chunk, offset);
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
  return requirePortableMediaContent(content);
}

async function* hashBody(
  reader: JournalReader,
  head: FrameHead,
  hash: Hash,
): AsyncGenerator<Uint8Array> {
  hash.update(
    encodeFrameStart(
      head.kind,
      head.kindHeader,
      (head.frameFlags & FRAME_FLAG_BODY) === 0 ? null : head.bodyLen,
    ),
  );
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

async function scanFrames(
  reader: JournalReader,
  hash: Hash,
  onContents: (contents: readonly IContent[]) => void,
): Promise<void> {
  let offset = JOURNAL_HEADER_BYTES;
  while (offset < reader.fileSize) {
    const head = await reader.readRecordHead(offset);
    if (head.kind === RECORD_KIND.ROW) {
      onContents([await scanRow(reader, head, hash)]);
    } else {
      for await (const chunk of hashBody(reader, head, hash)) {
        void chunk;
      }
    }
    offset = head.endOffset;
  }
}

export async function validateJournalRecording(
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
    } finally {
      await header.close();
    }
    await scanFrames(reader, hash, onContents);
    const after = await stat(path);
    if (boundedReadChanged(before, after, after, reader.fileSize))
      throw new Error('Packaged journal changed during validation');
    return { path, byteLength: reader.fileSize, sha256: hash.digest('hex') };
  } finally {
    await reader.close();
  }
}

async function copyJournalBytes(
  input: FileHandle,
  output: FileHandle,
  size: number,
): Promise<{ total: number; sha256: string }> {
  const sink = createFileHandleSink(output, 0);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let total = 0;
  for (;;) {
    const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > size) throw new Error('Packaged journal changed during read');
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    await sink(chunk);
  }
  return { total, sha256: hash.digest('hex') };
}

async function streamPinnedJournal(
  source: PinnedPackageFile,
  outputPath: string,
): Promise<PinnedPackageFile> {
  const path = source.path;
  const input = await open(path, 'r');
  try {
    const before = await input.stat();
    if (!before.isFile()) throw new Error('Packaged journal is not a file');
    const output = await open(outputPath, 'wx', 0o600);
    try {
      const { total, sha256 } = await copyJournalBytes(
        input,
        output,
        before.size,
      );
      if (
        boundedReadChanged(before, await input.stat(), await stat(path), total)
      ) {
        throw new Error('Packaged journal changed during read');
      }
      const pinned = { path, byteLength: total, sha256 };
      if (source.byteLength !== total || source.sha256 !== pinned.sha256) {
        throw new Error('Packaged journal changed after validation');
      }
      return pinned;
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

export async function writeImportedJournal(
  source: PinnedPackageFile,
  outputPath: string,
  projectHash: string,
  sessionId: string,
): Promise<void> {
  await streamPinnedJournal(source, outputPath);
  const session = await JournalSession.open(outputPath);
  try {
    const facts = await readSessionFacts((key) => session.store.getState(key));
    if (facts === undefined)
      throw new Error('Packaged journal has no session facts');
    const { cwd: _cwd, ...start } = facts.start;
    await session.store.commit([
      {
        kind: 'setState',
        key: SESSION_KEYS.id,
        value: encodeSessionFact(sessionId),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.start,
        value: encodeSessionFact({ ...start, projectHash, workspaceDirs: [] }),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.directories,
        value: encodeSessionFact([]),
      },
    ]);
  } finally {
    await session.close();
  }
}
