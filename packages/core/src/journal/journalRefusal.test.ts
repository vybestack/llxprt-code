/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';
import { JournalFormatError, RetiredJournalError } from './errors.js';
import { encodeJournalHeader, JOURNAL_FORMAT_VERSION } from './fileHeader.js';
import {
  readJournalHeaderOrRefuse,
  retiredJournalMessage,
} from './journalRefusal.js';
import { createFileHandleReader } from './positionalFile.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function validHeaderBytes(): Uint8Array {
  const random = new SeededRandom(11);
  return encodeJournalHeader({
    fileId: random.bytes(16),
    syncMarker: random.bytes(8),
    createdAtMs: 1_700_000_000_000,
  });
}

async function openWith(
  directory: string,
  name: string,
  content: Uint8Array | string,
) {
  const file = path.join(directory, name);
  await fs.writeFile(file, content);
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const header = await readJournalHeaderOrRefuse(
      file,
      createFileHandleReader(handle),
      size,
    );
    return { header, file };
  } finally {
    await handle.close();
  }
}

async function refusalFor(
  directory: string,
  name: string,
  content: Uint8Array | string,
): Promise<{ message: string; file: string }> {
  const file = path.join(directory, name);
  try {
    await openWith(directory, name, content);
  } catch (error) {
    if (error instanceof RetiredJournalError)
      return { message: error.message, file };
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('old-journal refusal', () => {
  const tempDir = useTempDir('journal-refusal-');

  it('words the single error exactly as design section 2.1 does', () => {
    expect(retiredJournalMessage('/chats/session-1.jsonl')).toBe(
      'Session file /chats/session-1.jsonl was recorded in the retired JSONL journal format (versions 1 and 2) and cannot be resumed. Start a new session.',
    );
  });

  it('refuses a JSONL file', async () => {
    const jsonl = '{"type":"session_start","version":2}\n{"type":"content"}\n';
    const { message, file } = await refusalFor(
      tempDir(),
      'session-a.jsonl',
      jsonl,
    );

    expect(message).toBe(retiredJournalMessage(file));
  });

  it('refuses a file with the wrong magic', async () => {
    const bytes = validHeaderBytes();
    bytes.set(new TextEncoder().encode('NOTAJRNL'), 0);
    bytes.set(
      new Uint8Array(new Uint32Array([crc32(bytes.subarray(0, 60))]).buffer),
      60,
    );
    const { message, file } = await refusalFor(
      tempDir(),
      'session-b.llxj',
      bytes,
    );

    expect(message).toBe(retiredJournalMessage(file));
  });

  for (const validCrc of [true, false]) {
    it(`names the incompatible binary version with a ${validCrc ? 'valid' : 'stale'} header CRC`, async () => {
      const bytes = validHeaderBytes();
      const foundVersion = JOURNAL_FORMAT_VERSION - 1;
      const view = new DataView(bytes.buffer);
      view.setUint32(8, foundVersion, true);
      if (validCrc) view.setUint32(60, crc32(bytes.subarray(0, 60)), true);
      const { message, file } = await refusalFor(
        tempDir(),
        'session-c.llxj',
        bytes,
      );

      expect(message).toBe(
        `Session file ${file} was written by an incompatible journal format version (found ${foundVersion}, supported ${JOURNAL_FORMAT_VERSION}) and cannot be resumed. Start a new session.`,
      );
    });
  }

  it('refuses an empty file and a file shorter than the magic', async () => {
    const empty = await refusalFor(tempDir(), 'empty.llxj', new Uint8Array(0));
    const short = await refusalFor(
      tempDir(),
      'short.llxj',
      new Uint8Array([0x4c, 0x4c]),
    );

    expect(empty.message).toBe(retiredJournalMessage(empty.file));
    expect(short.message).toBe(retiredJournalMessage(short.file));
  });

  it('accepts a current header and returns it', async () => {
    const bytes = validHeaderBytes();
    const { header } = await openWith(tempDir(), 'session-d.llxj', bytes);

    expect(header.createdAtMs).toBe(1_700_000_000_000);
    expect(header.fileId.length).toBe(16);
  });

  it('reports a damaged current header as corruption, not as the retired format', async () => {
    const bytes = validHeaderBytes();
    bytes[20] ^= 0x01;

    let caught: unknown;
    try {
      await openWith(tempDir(), 'session-e.llxj', bytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(JournalFormatError);
    expect(caught).not.toBeInstanceOf(RetiredJournalError);
  });

  it('reports a current magic and version with a cut-off header as a format error', async () => {
    const bytes = validHeaderBytes().subarray(0, 40);

    let caught: unknown;
    try {
      await openWith(tempDir(), 'session-f.llxj', bytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(JournalFormatError);
    expect(caught).not.toBeInstanceOf(RetiredJournalError);
  });
});
