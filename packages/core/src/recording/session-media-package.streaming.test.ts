/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectBackend } from '../services/history/historyBackendSelect.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  packageRecordingName,
  writePackageRecording,
  readPackageRows,
} from './__tests__/support/packageRecording.js';
import { JournalSession } from '../services/history/journalSession.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import type { IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import {
  importSessionMediaPackage,
  validateSessionMediaPackage,
} from './session-media-package.js';
import { HASH_CHUNK_BYTES } from './session-media-package-validation.js';

const PROJECT_HASH = 'streaming-project';
const ROW_TEXT = 'x'.repeat(4096);

function* rowBatches(rows: number): Generator<readonly IContent[]> {
  for (let first = 0; first < rows; first += 256) {
    yield Array.from(
      { length: Math.min(256, rows - first) },
      (_, index): IContent => ({
        speaker: 'human',
        blocks: [{ type: 'text', text: `${first + index}:${ROW_TEXT}` }],
      }),
    );
  }
}

async function writePackage(
  directory: string,
  rows: number,
): Promise<{ recordingPath: string; bytes: number }> {
  await mkdir(directory, { recursive: true });
  const recordingPath = await writePackageRecording(
    directory,
    rowBatches(rows),
    'other-project',
  );
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      version: 2,
      recording: packageRecordingName(),
      persistedStates: [],
      references: [],
      objects: [],
    }),
  );
  return { recordingPath, bytes: (await stat(recordingPath)).size };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertNativeIdentity(
  path: string,
  sessionId: string,
): Promise<void> {
  const facts = await readJournalFileFacts(path);
  expect(facts?.facts.sessionId).toBe(sessionId);
  expect(facts?.facts.start.projectHash).toBe(PROJECT_HASH);
  expect(facts?.facts.start.cwd).toBeUndefined();
  expect(facts?.facts.directories).toStrictEqual([]);
}

async function assertLegacyIdentity(
  path: string,
  sessionId: string,
): Promise<void> {
  const lines = (await readFile(path, 'utf8'))
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(lines).toHaveLength(301);
  const start = lines[0]['payload'] as Record<string, unknown>;
  expect(start['sessionId']).toBe(sessionId);
  expect(start['projectHash']).toBe(PROJECT_HASH);
  expect(start['cwd']).toBeUndefined();
  const last = lines[300]['payload'] as {
    content: { blocks: Array<{ text: string }> };
  };
  expect(last.content.blocks[0].text.startsWith('299:')).toBe(true);
}

async function peakExternalBuffers(work: () => Promise<void>): Promise<number> {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
  const baseline = process.memoryUsage().arrayBuffers;
  let peak = 0;
  const sampler = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().arrayBuffers - baseline);
  }, 1);
  try {
    await work();
  } finally {
    clearInterval(sampler);
  }
  return peak;
}

interface FileReadCounts {
  /** Largest single read request, in bytes, seen on any file handle. */
  maxRequestBytes: number;
  totalBytes: number;
  reads: number;
}

type FileHandleReader = (...args: unknown[]) => Promise<unknown>;

function requestedBytes(args: readonly unknown[]): number {
  const [target, , length] = args;
  if (ArrayBuffer.isView(target)) {
    return typeof length === 'number' ? length : target.byteLength;
  }
  const options = target as { buffer?: ArrayBufferView; length?: number };
  return options.length ?? options.buffer?.byteLength ?? 0;
}

/**
 * Counting IO seam: wraps the file handle reads the package code goes through
 * and records the largest single request and the bytes actually delivered.
 * A whole-recording read shows up as one request the size of the file.
 */
async function countFileHandleReads(
  work: () => Promise<void>,
): Promise<FileReadCounts> {
  const probe = await open(import.meta.path, 'r');
  const proto = Object.getPrototypeOf(probe) as {
    read: FileHandleReader;
    readFile: FileHandleReader;
  };
  await probe.close();
  const { read, readFile: readWhole } = proto;
  const counts: FileReadCounts = {
    maxRequestBytes: 0,
    totalBytes: 0,
    reads: 0,
  };
  proto.read = async function (this: unknown, ...args: unknown[]) {
    counts.reads += 1;
    counts.maxRequestBytes = Math.max(
      counts.maxRequestBytes,
      requestedBytes(args),
    );
    const result = (await read.apply(this, args)) as { bytesRead: number };
    counts.totalBytes += result.bytesRead;
    return result;
  };
  proto.readFile = async function (this: unknown, ...args: unknown[]) {
    counts.reads += 1;
    const bytes = (await readWhole.apply(this, args)) as { length: number };
    counts.maxRequestBytes = Math.max(counts.maxRequestBytes, bytes.length);
    counts.totalBytes += bytes.length;
    return bytes;
  };
  try {
    await work();
  } finally {
    proto.read = read;
    proto.readFile = readWhole;
  }
  return counts;
}

describe('streamed portable session import', () => {
  const backend = useBackendEnv();
  let tempDirectory = '';
  let store: LocalMediaStore;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-package-stream-'));
    store = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'media'),
      quotaBytes: 1024,
    });
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('imports every row with independent digests and rewritten identity', async () => {
    const packageDirectory = join(tempDirectory, 'package');
    const { recordingPath } = await writePackage(packageDirectory, 300);
    const chats = join(tempDirectory, 'chats');

    const imported = await importSessionMediaPackage(
      packageDirectory,
      chats,
      PROJECT_HASH,
      store,
    );

    const assertIdentity =
      selectBackend() === 'journal'
        ? assertNativeIdentity
        : assertLegacyIdentity;
    await assertIdentity(imported.recordingPath, imported.sessionId);
    const rows = await readPackageRows(imported.recordingPath, PROJECT_HASH);
    expect(rows).toHaveLength(300);
    for (const [index, row] of rows.entries()) {
      expect(row.blocks).toStrictEqual([
        { type: 'text', text: `${index}:${ROW_TEXT}` },
      ]);
    }
    expect(sha256(await readFile(recordingPath))).not.toBe(
      sha256(await readFile(imported.recordingPath)),
    );
    expect((await readdir(chats)).sort()).toStrictEqual([
      `session-imported-${imported.sessionId}${selectBackend() === 'journal' ? '.llxj' : '.jsonl'}`,
    ]);
  });

  it('rejects a recording that changed after validation and leaves no artifacts', async () => {
    const packageDirectory = join(tempDirectory, 'package');
    const { recordingPath, bytes } = await writePackage(packageDirectory, 20);
    const validated = await validateSessionMediaPackage(packageDirectory);
    expect(validated.recording.byteLength).toBe(bytes);
    const original = await readFile(recordingPath);
    const changed = Buffer.from(original);
    const textOffset = changed.indexOf('0:xxxx');
    expect(textOffset).toBeGreaterThan(0);
    changed.write('0:yyyy', textOffset);
    await writeFile(recordingPath, changed);
    const chats = join(tempDirectory, 'chats');

    await expect(
      importSessionMediaPackage(validated, chats, PROJECT_HASH, store),
    ).rejects.toThrow(/changed after validation/);

    await expect(readdir(chats)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.getStoredByteLength()).toBe(0);
  });

  it('rolls back published files when activation fails', async () => {
    const packageDirectory = join(tempDirectory, 'package');
    await writePackage(packageDirectory, 5);
    const chats = join(tempDirectory, 'chats');

    await expect(
      importSessionMediaPackage(
        packageDirectory,
        chats,
        PROJECT_HASH,
        store,
        async () => {
          throw new Error('activation refused');
        },
      ),
    ).rejects.toThrow('activation refused');

    await expect(readdir(chats)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a recording line above the finite line limit', async () => {
    backend('old');
    const packageDirectory = join(tempDirectory, 'package');
    const { recordingPath } = await writePackage(packageDirectory, 1);
    await appendFile(recordingPath, `${'y'.repeat(65 * 1024 * 1024)}\n`);

    await expect(validateSessionMediaPackage(packageDirectory)).rejects.toThrow(
      /line exceeds finite byte limit/,
    );
  });

  it('validates native chunk boundaries and short state keys without changing recording digests', async () => {
    backend('journal');
    const directory = join(tempDirectory, 'boundaries');
    await mkdir(directory);
    const rows: IContent[] = [
      4,
      20,
      HASH_CHUNK_BYTES - 1,
      HASH_CHUNK_BYTES,
      HASH_CHUNK_BYTES + 1,
      3 * HASH_CHUNK_BYTES,
    ].map((size, index) => ({
      speaker: 'human',
      blocks: [{ type: 'text', text: `${index}:${'z'.repeat(size)}` }],
    }));
    const path = await writePackageRecording(directory, [rows], PROJECT_HASH);
    const session = await JournalSession.open(path);
    try {
      await session.store.commit([
        { kind: 'setState', key: 'abcd', value: Buffer.from('four') },
        {
          kind: 'setState',
          key: 'abcdefghijklmnopqrst',
          value: Buffer.from('twenty'),
        },
      ]);
    } finally {
      await session.close();
    }
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: 2,
        recording: 'session.llxj',
        persistedStates: [],
        references: [],
        objects: [],
      }),
    );
    const validated = await validateSessionMediaPackage(directory);
    expect(validated.recording.sha256).toBe(sha256(await readFile(path)));
    const imported = await importSessionMediaPackage(
      validated,
      join(tempDirectory, 'chats'),
      PROJECT_HASH,
      store,
    );
    expect(
      (await readPackageRows(imported.recordingPath, PROJECT_HASH)).map(
        (row) => row.blocks,
      ),
    ).toStrictEqual(rows.map((row) => row.blocks));
    const bytes = await readFile(path);
    const bodyOffset = bytes.indexOf('5:zzzz');
    expect(bodyOffset).toBeGreaterThan(0);
    bytes[bodyOffset + HASH_CHUNK_BYTES + 1] ^= 1;
    await writeFile(path, bytes);
    await expect(validateSessionMediaPackage(directory)).rejects.toMatchObject({
      name: 'JournalCorruptionError',
      path,
      cause: { code: 'body-crc-mismatch' },
    });
  });

  it('rejects a native recording with an uncommitted oversized tail before publication', async () => {
    backend('journal');
    const directory = join(tempDirectory, 'native-tail');
    const { recordingPath } = await writePackage(directory, 1);
    await appendFile(recordingPath, Buffer.alloc(65 * 1024 * 1024, 121));
    await expect(
      importSessionMediaPackage(
        directory,
        join(tempDirectory, 'chats'),
        PROJECT_HASH,
        store,
      ),
    ).rejects.toThrow(
      'Packaged journal is truncated or has an uncommitted tail',
    );
    await expect(readdir(join(tempDirectory, 'chats'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await store.getStoredByteLength()).toBe(0);
  });

  it('validates and imports a large recording without buffering it whole', async () => {
    const packageDirectory = join(tempDirectory, 'package');
    const { bytes } = await writePackage(packageDirectory, 16_000);
    expect(bytes).toBeGreaterThan(64 * 1024 * 1024);
    const chats = join(tempDirectory, 'chats');

    // Trap control: the sampler must see a whole-file read as a whole file.
    const wholeFile = await peakExternalBuffers(async () => {
      const held = await readFile(
        join(packageDirectory, packageRecordingName()),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(held.byteLength).toBe(bytes);
    });
    expect(wholeFile).toBeGreaterThanOrEqual(bytes);

    const streamed = await peakExternalBuffers(async () => {
      const validated = await validateSessionMediaPackage(packageDirectory);
      await importSessionMediaPackage(validated, chats, PROJECT_HASH, store);
    });
    expect(streamed).toBeLessThan(bytes / 4);
  });

  it('reads the recording only in bounded chunks and a whole-file read trips the same check', async () => {
    const packageDirectory = join(tempDirectory, 'package');
    const { bytes } = await writePackage(packageDirectory, 16_000);
    const recordingPath = join(packageDirectory, packageRecordingName());
    const bounded = (counts: FileReadCounts) =>
      counts.maxRequestBytes <= HASH_CHUNK_BYTES;

    // Trap controls: each whole-file read style must fail the bounded check.
    const wholeBuffer = await countFileHandleReads(async () => {
      const handle = await open(recordingPath, 'r');
      try {
        await handle.read(Buffer.allocUnsafe(bytes), 0, bytes, null);
      } finally {
        await handle.close();
      }
    });
    expect(wholeBuffer.maxRequestBytes).toBe(bytes);
    expect(bounded(wholeBuffer)).toBe(false);
    const wholeFile = await countFileHandleReads(async () => {
      const handle = await open(recordingPath, 'r');
      try {
        await handle.readFile();
      } finally {
        await handle.close();
      }
    });
    expect(bounded(wholeFile)).toBe(false);

    const chats = join(tempDirectory, 'chats');
    const streamed = await countFileHandleReads(async () => {
      const validated = await validateSessionMediaPackage(packageDirectory);
      await importSessionMediaPackage(validated, chats, PROJECT_HASH, store);
    });
    expect(bounded(streamed)).toBe(true);
    // Validation and import each stream the whole recording once.
    expect(streamed.totalBytes).toBeGreaterThanOrEqual(2 * bytes);
    expect(streamed.reads).toBeGreaterThanOrEqual(
      (2 * bytes) / HASH_CHUNK_BYTES,
    );
  });
});
