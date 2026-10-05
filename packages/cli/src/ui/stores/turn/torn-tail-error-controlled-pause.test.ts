/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createReadStream, truncateSync } from 'node:fs';
import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';

const byteCeiling = 8_388_608;
const objectCeiling = 440;
const chunkBytes = 65_536;
const evidenceRoot = join(process.cwd(), 'tmp/verify854/p05d');

function human(seq: number, text: string): string {
  return `${JSON.stringify({ v: 1, seq, ts: '', type: 'content', payload: { content: { speaker: 'human', blocks: [{ type: 'text', text }] } } })}\n`;
}

async function fixture(
  action: (directory: string, file: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(evidenceRoot, 'torn-cli-'));
  const file = join(directory, 'journal');
  try {
    await writeFile(file, human(1, 'complete-one') + human(2, 'complete-two'));
    await appendFile(
      file,
      '{"v":1,"seq":3,"type":"content","payload":{"content":{"speaker":"human","blocks":[{"type":"text","text":"',
    );
    await appendFile(file, 'x'.repeat(byteCeiling + chunkBytes));
    await action(directory, file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function scanner(ownership: RowOwnership) {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let assembledSinceNewline = 0;
  let peakTextBytes = 0;
  let peakChunkView = 0;
  let pausedCharge = 0;
  let pausedLiveRows = 0;
  let lastChunkBytes = 0;
  async function pause(): Promise<void> {
    const live = ownership.snapshot();
    pausedLiveRows = live.liveRows;
    pausedCharge =
      assembledSinceNewline + lastChunkBytes + live.liveSerializedBytes;
    enter();
    await gate;
  }
  async function* read(
    path: string,
    signal: AbortSignal,
    endExclusive?: number,
  ): AsyncIterable<string> {
    const stream = createReadStream(path, {
      encoding: 'utf8',
      highWaterMark: chunkBytes,
      end: endExclusive === undefined ? undefined : endExclusive - 1,
      signal,
    });
    try {
      for await (const chunk of stream) {
        const text = String(chunk);
        const lastNewline = text.lastIndexOf('\n');
        assembledSinceNewline =
          lastNewline === -1
            ? assembledSinceNewline + Buffer.byteLength(text)
            : Buffer.byteLength(text.slice(lastNewline + 1));
        peakTextBytes = Math.max(peakTextBytes, assembledSinceNewline);
        lastChunkBytes = Buffer.byteLength(text);
        peakChunkView = Math.max(peakChunkView, lastChunkBytes);
        yield text;
        if (assembledSinceNewline > byteCeiling) await pause();
      }
    } finally {
      if (endExclusive !== undefined) await pause();
      stream.destroy();
    }
  }
  return {
    read,
    entered,
    release,
    snapshot: () => ({
      peakTextBytes,
      peakChunkView,
      configuredChunkBytes: chunkBytes,
      pausedCharge,
      pausedLiveRows,
    }),
  };
}

async function verifyTornAccumulation(): Promise<number> {
  let pausedCharge = 0;
  await fixture(async (directory, file) => {
    const ownership = new RowOwnership();
    const stats = createRowCounters();
    const scan = scanner(ownership);
    let cursor: ProjectedJournalCursor | undefined;
    const pending = ProjectedJournalCursor.open(file, {
      temporaryRoot: directory,
      counters: { ...stats.counters, ownership },
      readBounded: scan.read,
    });
    try {
      try {
        await scan.entered;
        expect(stats.snapshot().rowsDecoded).toBe(2);
        expect(stats.snapshot().peakDecodedRows).toBeLessThanOrEqual(1);
        expect(ownership.snapshot().liveRows).toBe(1);
        expect(scan.snapshot().peakTextBytes).toBeLessThanOrEqual(byteCeiling);
        expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(
          objectCeiling,
        );
      } finally {
        scan.release();
      }
      cursor = await pending;
      const page = await cursor.pageBack(5);
      expect(page.entries.map((entry) => entry.seq)).toStrictEqual([2, 1]);
      expect(cursor.size()).toBe(
        Buffer.byteLength(human(1, 'complete-one') + human(2, 'complete-two')),
      );
      expect(scan.snapshot().peakChunkView).toBeLessThanOrEqual(chunkBytes);
    } finally {
      scan.release();
      cursor ??= await pending;
      await cursor.close();
      await writeFile(
        join(evidenceRoot, `torn-cli-${process.pid}.json`),
        JSON.stringify(
          {
            ...scan.snapshot(),
            rowsDecodedAtPause: 2,
            scope:
              'real file stream; accumulator inferred from delivered UTF-8 ASCII chunks; buffer capacities and JS/native allocations not measured',
          },
          null,
          2,
        ),
      );
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await readdir(directory)).toStrictEqual(['journal']);
    }
    pausedCharge = scan.snapshot().pausedCharge;
  });
  return pausedCharge;
}

async function verifyFailedPageRead(): Promise<void> {
  await fixture(async (directory, file) => {
    const ownership = new RowOwnership();
    const stats = createRowCounters();
    const cursor = await ProjectedJournalCursor.open(file, {
      temporaryRoot: directory,
      counters: { ...stats.counters, ownership },
    });
    let held: object | undefined;
    try {
      const first = await cursor.pageBack(1);
      if (first.entries[0]?.kind !== 'projected')
        throw new Error('missing first projected page');
      held = first.entries[0].item;
      ownership.retain(held);
      expect(ownership.snapshot().liveRows).toBe(1);
      const scratch = (await readdir(directory)).find((name) =>
        name.startsWith('llxprt-display-pages-'),
      );
      if (!scratch) throw new Error('missing projected page file');
      truncateSync(join(directory, scratch, 'data'), 0);
      await expect(cursor.pageBack(2)).rejects.toThrow(
        'Truncated journal page',
      );
      expect(ownership.snapshot().liveRows).toBe(1);
    } finally {
      await cursor.close();
      if (held) ownership.release(held);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(await readdir(directory)).toStrictEqual(['journal']);
    }
  });
}

describe('projected cursor torn tail and page errors', () => {
  it('keeps a complete oversized record visible when followed by a torn suffix', async () => {
    const directory = await mkdtemp(join(evidenceRoot, 'complete-cli-'));
    const file = join(directory, 'journal');
    const first = human(1, 'complete-one');
    const large = human(2, 'x'.repeat(byteCeiling));
    const tail = human(3, 'incomplete').slice(0, -1);
    await writeFile(file, first + large + tail);
    let cursor: ProjectedJournalCursor | undefined;
    try {
      cursor = await ProjectedJournalCursor.open(file, {
        temporaryRoot: directory,
      });
      expect(cursor.size()).toBe(Buffer.byteLength(first + large));
      expect(
        (await cursor.pageBack(5)).entries.map((entry) => entry.seq),
      ).toStrictEqual([2, 1]);
    } finally {
      await cursor?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 120000);
  it('discovers a completed torn suffix on the next forward page', async () => {
    await fixture(async (directory, file) => {
      const cursor = await ProjectedJournalCursor.open(file, {
        temporaryRoot: directory,
      });
      try {
        expect(
          (await cursor.pageBack(5)).entries.map((entry) => entry.seq),
        ).toStrictEqual([2, 1]);
        const prefixBytes = Buffer.byteLength(
          human(1, 'complete-one') + human(2, 'complete-two'),
        );
        expect(cursor.size()).toBe(prefixBytes);
        cursor.retainWindow(undefined, undefined, 'older');
        await appendFile(file, '"}]}}}\n');
        const page = await cursor.pageForward(5);
        expect(page.entries.map((entry) => entry.seq)).toStrictEqual([3]);
        expect(cursor.size()).toBeGreaterThan(prefixBytes);
      } finally {
        await cursor.close();
      }
    });
  }, 120000);
  it('pauses a real chunk reader after the complete prefix and excludes the torn row without exceeding the logical byte ceiling', async () => {
    expect(await verifyTornAccumulation()).toBeLessThanOrEqual(byteCeiling);
  }, 120000);
  it('reports a failed projected page read without handing out partial results and releases a held consumer on close', async () => {
    await expect(verifyFailedPageRead()).resolves.toBeUndefined();
  });
});
