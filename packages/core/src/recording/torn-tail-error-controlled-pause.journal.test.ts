/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { iterateRowEntries, rowTreeRootOf } from '../journal/rowTreeReader.js';
import { readStoredRow } from '../journal/rowReads.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import { JournalSession } from '../services/history/journalSession.js';
import { createRowCounters } from './journalCounters.js';
import { RowOwnership } from './rowOwnership.js';
import { JournalRecordingService } from './journalRecordingService.js';

const byteCeiling = 8_388_608;
const objectCeiling = 440;

async function withDirectory(
  action: (dir: string) => Promise<void>,
  parent = tmpdir(),
): Promise<void> {
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'torn-core-'));
  try {
    await action(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verifyCoreScan(): Promise<void> {
  await withDirectory(async (dir) => {
    const file = join(dir, 'journal.llxj');
    const session = await JournalSession.create(file);
    await session.append(
      ['one', 'two'].map((text, index) => ({
        speaker: 'human',
        blocks: [{ type: 'text', text }],
        metadata: {
          chronology: { seq: index + 1, userTurn: 1, step: 0, recordedAt: 0 },
        },
      })),
    );
    const durableEnd = session.store.published?.durableEnd;
    await session.close();
    const tail = new Uint8Array(byteCeiling + 65_536).fill(0x78);
    await appendFile(file, tail);
    expect(tail.byteLength).toBeGreaterThan(byteCeiling);
    const stats = createRowCounters();
    const ownership = new RowOwnership();
    let largestRead = 0;
    const reader = await openJournalReadOnly(file, {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: (buffer, offset, length, position) =>
            handle.write(buffer, offset, length, position),
          writev: async (buffers, position) => ({
            bytesWritten: (await handle.writev(buffers, position)).bytesWritten,
          }),
          read: (buffer, offset, length, position) => {
            largestRead = Math.max(largestRead, length);
            return handle.read(buffer, offset, length, position);
          },
        };
      },
    });
    try {
      expect(stats.snapshot().rowsDecoded).toBe(0);
      expect(reader.fileSize).toBe(Number(durableEnd) + tail.byteLength);
      expect(reader.trailer?.durableEnd).toBe(durableEnd);
      expect(largestRead).toBeLessThan(byteCeiling);
      largestRead = 0;
      const root = rowTreeRootOf(reader.trailer);
      if (root === undefined) throw new Error('Missing committed rows');
      const sequences: number[] = [];
      const offsets: number[] = [];
      for await (const entry of iterateRowEntries(reader, root)) {
        const row = decodeStoredRow(await readStoredRow(reader, entry));
        stats.counters.rowDecoded();
        ownership.retain(row);
        try {
          sequences.push(row.metadata?.chronology?.seq ?? 0);
          offsets.push(entry.recordOffset);
        } finally {
          ownership.release(row);
          stats.counters.rowReleased();
        }
      }
      expect(sequences.slice().reverse()).toStrictEqual([2, 1]);
      expect(sequences).toStrictEqual([1, 2]);
      expect(offsets.every((offset) => offset < Number(durableEnd))).toBe(true);
      expect(stats.snapshot().rowsDecoded).toBe(2);
      expect(stats.snapshot().peakDecodedRows).toBe(1);
      expect(largestRead).toBeLessThan(65_536);
      expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(objectCeiling);
      expect(ownership.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
        byteCeiling,
      );
    } finally {
      await reader.close();
      expect(ownership.snapshot().liveRows).toBe(0);
    }
  });
}

async function verifyAppendFault(code: string): Promise<void> {
  await withDirectory(async (dir) => {
    let enter: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = Object.assign(new Error(`injected ${code}`), { code });
    let armed = false;
    let pendingBytes = 0;
    let acknowledgements = 0;
    const write = async <T>(
      bytes: number,
      action: () => Promise<T>,
    ): Promise<T> => {
      if (!armed) return action();
      pendingBytes += bytes;
      enter();
      try {
        await gate;
        throw failure;
      } finally {
        pendingBytes -= bytes;
      }
    };
    const service = JournalRecordingService.create({
      sessionId: `append-${code}`,
      projectHash: 'p',
      chatsDir: dir,
      workspaceDirs: [],
      cwd: dir,
      provider: 'test',
      model: 'test',
      journal: {
        journal: {
          open: async (path, flags) => {
            const handle = await open(path, flags);
            return {
              fd: handle.fd,
              read: (buffer, offset, length, position) =>
                handle.read(buffer, offset, length, position),
              stat: () => handle.stat(),
              truncate: (length) => handle.truncate(length),
              close: () => handle.close(),
              write: (buffer, offset, length, position) =>
                write(length, () =>
                  handle.write(buffer, offset, length, position),
                ),
              writev: (buffers, position) =>
                write(
                  buffers.reduce(
                    (bytes, buffer) => bytes + buffer.byteLength,
                    0,
                  ),
                  async () => ({
                    bytesWritten: (await handle.writev(buffers, position))
                      .bytesWritten,
                  }),
                ),
            };
          },
        },
      },
    });
    await service.session();
    armed = true;
    service.onCommitAck(() => {
      acknowledgements++;
    });
    const settled: string[] = [];
    try {
      const commits = ['one', 'two', 'three'].map((name) =>
        service.setSessionName(name).then(
          () => {
            settled.push('resolved');
            return undefined;
          },
          (error: unknown) => {
            settled.push('rejected');
            return error;
          },
        ),
      );
      try {
        await entered;
        expect(pendingBytes).toBeGreaterThan(0);
        expect(settled).toStrictEqual([]);
      } finally {
        release();
      }
      expect(await Promise.all(commits)).toStrictEqual([
        failure,
        failure,
        failure,
      ]);
      expect(settled).toStrictEqual(['rejected', 'rejected', 'rejected']);
      expect(pendingBytes).toBe(0);
      await expect(service.flush()).rejects.toBe(failure);
      await expect(service.setSessionName('late')).rejects.toThrow(
        'recording is not active',
      );
      expect(acknowledgements).toBe(0);
    } finally {
      release();
      await service.dispose();
    }
  });
}

describe('native core reader and injected positional write failure', () => {
  it('creates a fixture directory when its parent is absent', async () => {
    const parent = join(tmpdir(), `fixture-parent-${randomUUID()}`);
    try {
      await withDirectory(async (dir) => {
        expect((await stat(dir)).isDirectory()).toBe(true);
      }, parent);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it('ignores a torn >8 MiB suffix without decoding it and preserves both complete rows', async () => {
    await expect(verifyCoreScan()).resolves.toBeUndefined();
  }, 120000);
  it.each(['EACCES', 'ENOSPC'])(
    'rejects every pending commit when a held write fails with %s and releases writer-owned state',
    async (code) => {
      await expect(verifyAppendFault(code)).resolves.toBeUndefined();
    },
  );
});
