/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { JournalCursor } from './journalCursor.js';
import { createRowCounters } from './journalCounters.js';
import { RowOwnership } from './rowOwnership.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import type { RecordingWriterIo, RecordingWriterObservation } from './types.js';

const byteCeiling = 8_388_608;
const objectCeiling = 440;
const evidenceRoot = join(process.cwd(), 'tmp/verify854/p05d');

async function withDirectory(
  action: (dir: string) => Promise<void>,
  parent = evidenceRoot,
): Promise<void> {
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'torn-core-'));
  try {
    await action(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function human(seq: number, text: string): string {
  return `${JSON.stringify({ v: 1, seq, ts: '', type: 'content', payload: { content: { speaker: 'human', blocks: [{ type: 'text', text }] } } })}\n`;
}

async function recordEvidence(name: string, value: unknown): Promise<void> {
  await writeFile(
    join(evidenceRoot, `${name}-${process.pid}.json`),
    JSON.stringify(value, null, 2),
  );
}

async function verifyCoreScan(): Promise<void> {
  await withDirectory(async (dir) => {
    const file = join(dir, 'journal');
    const prefix = human(1, 'one') + human(2, 'two');
    const tail =
      '{"v":1,"seq":3,"type":"content","payload":{"content":{"speaker":"human","blocks":[{"type":"text","text":"' +
      'x'.repeat(byteCeiling + 65_536);
    await writeFile(file, prefix);
    await appendFile(file, tail);
    expect(Buffer.byteLength(tail)).toBeGreaterThan(byteCeiling);
    const stats = createRowCounters();
    const ownership = new RowOwnership();
    const cursor = await JournalCursor.open(file, {
      chunkBytes: 65_536,
      counters: { ...stats.counters, ownership },
    });
    try {
      expect(stats.snapshot().rowsDecoded).toBe(0);
      expect(cursor.size()).toBe(
        Buffer.byteLength(prefix) + Buffer.byteLength(tail),
      );
      expect(cursor.windowStart()).toBe(Buffer.byteLength(prefix));
      expect(cursor.metrics().maxAssembledRecordBytes).toBe(0);
      const page = await cursor.pageBack(10);
      expect(
        page.entries.map((entry) =>
          entry.kind === 'content' ? entry.seq : null,
        ),
      ).toStrictEqual([2, 1]);
      expect(page.envelopes.map((entry) => entry.seq)).toStrictEqual([1, 2]);
      expect(
        page.envelopes.every(
          (entry) => entry.offset < Buffer.byteLength(prefix),
        ),
      ).toBe(true);
      expect(stats.snapshot().rowsDecoded).toBe(2);
      expect(stats.snapshot().peakDecodedRows).toBe(2);
      expect(cursor.metrics().maxAssembledRecordBytes).toBeLessThan(65_536);
      expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(objectCeiling);
      expect(ownership.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
        byteCeiling,
      );
      await recordEvidence('torn-core', {
        tailBytes: Buffer.byteLength(tail),
        prefixBytes: Buffer.byteLength(prefix),
        configuredChunkBytes: 65_536,
        maximumDecodedLineBytes: cursor.metrics().maxAssembledRecordBytes,
        decodedBeforePage: 0,
        decodedAfterPage: stats.snapshot().rowsDecoded,
        rowCharge: ownership.snapshot(),
        scope:
          'core backwards scan: no observation seam for allocated chunks; 65536 is a configured upper bound, not a measured chunk peak',
      });
    } finally {
      await cursor.close();
      expect(ownership.snapshot().liveRows).toBe(0);
    }
  });
}

type Observation = {
  phase: RecordingWriterObservation['phase'];
  queueBytes: number;
  batch: number;
  pendingAcks: number;
  linesBytes: number;
};

function observe(state: RecordingWriterObservation): Observation {
  return {
    phase: state.phase,
    queueBytes: state.queueBytes,
    batch: state.batch.length,
    pendingAcks: state.pendingAcks,
    linesBytes: state.lines === null ? 0 : Buffer.byteLength(state.lines),
  };
}

function faultService(
  dir: string,
  code: string,
  io: RecordingWriterIo,
  observations: Observation[],
): SessionRecordingService {
  return new SessionRecordingService({
    sessionId: `append-${code}`,
    projectHash: 'p',
    chatsDir: dir,
    workspaceDirs: [],
    cwd: dir,
    provider: 'test',
    model: 'test',
    io,
    observeWriter(state) {
      observations.push(observe(state));
    },
  });
}

async function verifyAppendFault(code: string): Promise<void> {
  await withDirectory(async (dir) => {
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = Object.assign(new Error(`injected ${code}`), { code });
    const observations: Observation[] = [];
    const io: RecordingWriterIo = {
      async appendFile() {
        enter();
        await gate;
        throw failure;
      },
    };
    const service = faultService(dir, code, io, observations);
    const settled: string[] = [];
    try {
      const commits = ['one', 'two', 'three'].map((text) =>
        service
          .commit('content', {
            content: { speaker: 'human', blocks: [{ type: 'text', text }] },
          })
          .then(
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
        const append = observations.find((point) => point.phase === 'append');
        expect(append?.batch).toBeGreaterThan(0);
        expect(append?.linesBytes).toBeGreaterThan(0);
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
      expect(service.getPendingRecordCount()).toBe(0);
      expect(service.getPendingByteCount()).toBe(0);
      await expect(
        service.commit('content', {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'late' }],
          },
        }),
      ).rejects.toBe(failure);
      expect(observations.some((point) => point.phase === 'acked')).toBe(false);
      await recordEvidence(`append-${code}`, {
        code,
        observations,
        outcome: settled,
        scope:
          'injected one-shot append rejection before durable bytes; does not prove disk-full or crash behavior',
      });
    } finally {
      release();
      await service.dispose();
    }
  });
}

describe('real core cursor and injected append failure', () => {
  it('creates a fixture directory when its evidence parent is absent', async () => {
    const parent = join(evidenceRoot, `fixture-parent-${randomUUID()}`);
    try {
      await withDirectory(async (dir) => {
        expect((await stat(dir)).isDirectory()).toBe(true);
      }, parent);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('scans past a torn >8 MiB suffix without decoding or returning it, then preserves both complete rows', async () => {
    await expect(verifyCoreScan()).resolves.toBeUndefined();
  }, 120000);
  it.each(['EACCES', 'ENOSPC'])(
    'rejects every pending commit when a held append fails with %s and releases writer-owned state',
    async (code) => {
      await expect(verifyAppendFault(code)).resolves.toBeUndefined();
    },
  );
});
