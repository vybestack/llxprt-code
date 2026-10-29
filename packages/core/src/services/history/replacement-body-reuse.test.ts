/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalSession } from './journalSession.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { detachedRows } from './detached-rollback-test-helpers.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { RECORD_KIND } from '../../journal/recordKinds.js';
import { TranscriptReader } from '../../journal/transcript-reader.js';
import { ChronologyFacts } from '../../journal/chronologyFacts.js';
import { sha256KeyHash } from '../../journal/idKeys.js';

async function countBodies(
  file: string,
  size: number,
): Promise<{ rows: number; bytes: number }> {
  const handle = await open(file, 'r');
  try {
    return await scanBodies(handle, size);
  } finally {
    await handle.close();
  }
}

async function scanBodies(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<{ rows: number; bytes: number }> {
  let rows = 0;
  let bytes = 0;
  const buffer = Buffer.alloc(64 * 1024);
  let start = -buffer.length;
  let length = 0;
  for (let offset = 64; offset < size; ) {
    if (offset < start || offset + 24 > start + length) {
      start = offset;
      length = (await handle.read(buffer, 0, buffer.length, start)).bytesRead;
    }
    const at = offset - start;
    if (at + 24 > length) throw new Error('Truncated committed frame');
    const frameBytes =
      24 + buffer.readUInt32LE(at + 4) + Number(buffer.readBigUInt64LE(at + 8));
    if (buffer[at] === RECORD_KIND.ROW) {
      rows++;
      bytes += frameBytes;
    }
    offset += frameBytes;
  }
  return { rows, bytes };
}

async function bodies(
  file: string,
): Promise<{ rows: number; bytes: number; transcriptRows: number }> {
  const journal = await openJournalReadOnly(file);
  try {
    const { rows, bytes } = await countBodies(file, journal.fileSize);
    const reader = new TranscriptReader(journal, sha256KeyHash);
    const page = await reader.page({ direction: 'backward', limit: 1 });
    return { rows, bytes, transcriptRows: Number(page[0]?.transcriptId ?? 0n) };
  } finally {
    await journal.close();
  }
}

describe('replacement physical body reuse', () => {
  const directory = useTempDir('replacement-body-reuse-');
  for (const size of [2048, 8192]) {
    it(`does not encode new physical bodies for ${size} unchanged rows`, async () => {
      const file = join(directory(), `${size}.llxj`);
      const seams = testJournalSeams();
      const session = await JournalSession.create(file, {
        journal: seams.dependencies,
      });
      const history = new JournalHistoryStore(session);
      try {
        await history.replaceFrom(detachedRows(size), size);
        const before = await bodies(file);
        const eventStart = seams.events.length;
        const at = performance.now();
        await history.replaceFrom(detachedRows(size), size);
        const elapsed = performance.now() - at;
        const writes = seams.events
          .slice(eventStart)
          .filter((event) => event.type === 'write');
        const writtenBytes = writes.reduce(
          (sum, event) => sum + event.length,
          0,
        );
        const after = await bodies(file);
        process.stdout.write(
          `REPLACEMENT_BODY_REUSE ${JSON.stringify({ size, elapsed, writes: writes.length, writtenBytes, bodyBytesPerRow: (after.bytes - before.bytes) / size })}\n`,
        );
        expect(after.rows - before.rows).toBe(0);
        expect((after.bytes - before.bytes) / size).toBe(0);
        expect(after.transcriptRows).toBe(before.transcriptRows);
        let count = 0;
        for await (const row of history.streamRows()) {
          expect(row.metadata?.chronology?.seq).toBe(++count);
        }
        expect(count).toBe(size);
      } finally {
        await history.dispose();
      }
    }, 180000);
  }
  it('writes a changed row and preserves reordered unchanged bodies', async () => {
    const file = join(directory(), 'changed.llxj');
    const session = await JournalSession.create(file);
    const history = new JournalHistoryStore(session);
    const rows = [];
    for await (const row of detachedRows(3)) rows.push(row);
    try {
      await history.replaceFrom(rows, 3);
      const before = await bodies(file);
      await history.replaceFrom(
        [
          rows[2],
          { ...rows[1], blocks: [{ type: 'text', text: 'changed' }] },
          rows[0],
        ],
        3,
      );
      const after = await bodies(file);
      expect(after.rows - before.rows).toBe(1);
      const restored = [];
      for await (const row of history.streamRows()) restored.push(row);
      expect(
        restored.map((row) => row.metadata?.chronology?.seq),
      ).toStrictEqual([3, 2, 1]);
      expect(restored[1].blocks).toStrictEqual([
        { type: 'text', text: 'changed' },
      ]);
      const snapshot = await session.store.snapshot();
      try {
        const chronology = new ChronologyFacts(snapshot.facts);
        for (const [index, seq] of [3, 2, 1].entries()) {
          expect(await chronology.label(BigInt(seq), false, 1)).toBe(
            (await snapshot.entryAt(index)).label,
          );
        }
      } finally {
        await snapshot.close();
      }
    } finally {
      await history.dispose();
    }
  });
});
