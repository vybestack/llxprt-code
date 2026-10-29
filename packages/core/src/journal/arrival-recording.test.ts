/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { RECORD_KIND } from './recordKinds.js';
import { JournalStore } from './journalStore.js';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function readTail(path: string) {
  const journal = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(journal, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 50 });
    const rows = [];
    for (const entry of entries)
      if (entry.rowRef !== 0) rows.push(await reader.readRow(entry));
    return {
      entries,
      rows,
      members: await reader.membership(entries.map((e) => e.transcriptId)),
    };
  } finally {
    await journal.close();
  }
}

async function payloadBytesOnDisk(path: string): Promise<number> {
  const journal = await openJournalReadOnly(path);
  let bytes = 0;
  try {
    let offset = JOURNAL_HEADER_BYTES;
    while (offset < (journal.trailer?.durableEnd ?? 0)) {
      const head = await journal.readRecordHead(offset);
      if (head.kind === RECORD_KIND.PIECE) bytes += head.bodyLen;
      offset = head.endOffset;
    }
    return bytes;
  } finally {
    await journal.close();
  }
}

function seed() {
  return { ...draftRow({ text: '' }), blocks: [] };
}

describe('arrival recording', () => {
  const directory = useTempDir('arrival-recording-');

  it('publishes bounded pieces before source exhaustion and seals without rewriting payload', async () => {
    const path = join(directory(), 'progress.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(seed(), {
        id: 'attempt-1',
        submissionId: 'prompt-1',
      });
      const block = await recorder.beginBlock(row, 0);
      const bytes = new TextEncoder().encode('a'.repeat(8192));
      for (let i = 0; i < 16; i++) await recorder.appendField(block, bytes);
      await recorder.flush();
      const progress = await readTail(path);
      expect(progress.entries[0].status).toBe(0);
      expect(progress.rows[0].blocks[0]).toHaveLength(16 * bytes.length);
      expect(progress.members[0].count).toBe(0);
      expect(store.published?.rows).toBe(0);
      expect(recorder.census.peakBytes).toBeLessThanOrEqual(256 * 1024);
      expect(recorder.census.peakPieces).toBeLessThanOrEqual(32);
      const before = recorder.census.payloadBytes;
      const physicalPayload = await payloadBytesOnDisk(path);
      expect(physicalPayload).toBe(131072);
      await recorder.endBlock(block);
      await recorder.sealRow(row, { usage: { outputTokens: 42 } });
      const sealed = await readTail(path);
      expect(sealed.entries[0].transcriptId).toBe(row.transcriptId);
      expect(sealed.entries[0].status).toBe(1);
      expect(sealed.members[0].count).toBe(1);
      expect(store.published?.rows).toBe(1);
      expect(recorder.census.payloadBytes).toBe(before);
      expect(await payloadBytesOnDisk(path)).toBe(physicalPayload);
      const rows = store.rows();
      try {
        const entry = await rows.next();
        expect(entry.value).toBeDefined();
        if (entry.value === undefined) throw new Error('Missing sealed entry');
        expect((await store.readRow(entry.value)).blocks[0]).toStrictEqual(
          progress.rows[0].blocks[0],
        );
      } finally {
        await rows.return(undefined);
      }
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('rejects a completion-only accumulator at the unfinished-source disk gate', async () => {
    const path = join(directory(), 'deferred-control.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const retained: Uint8Array[] = [];
    try {
      await store.commit([{ kind: 'append', rows: [] }]);
      for (let index = 0; index < 16; index++)
        retained.push(new Uint8Array(8192));
      const tail = await readTail(path);
      const accepted = tail.rows.some((row) =>
        row.blocks.some((block) => block.length >= 65536),
      );
      expect(accepted).toBe(false);
      expect(retained.reduce((bytes, piece) => bytes + piece.length, 0)).toBe(
        131072,
      );
    } finally {
      await store.close();
    }
  });

  it('flushes a stalled source on the timer', async () => {
    const path = join(directory(), 'timer.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(seed(), {
        id: 'stall',
        submissionId: 'prompt',
      });
      const block = await recorder.beginBlock(row, 0);
      await recorder.appendField(block, new TextEncoder().encode('prefix'));
      await Bun.sleep(100);
      expect(
        new TextDecoder().decode((await readTail(path)).rows[0].blocks[0]),
      ).toBe('prefix');
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('preserves cancelled output and gives retry a new transcript identity', async () => {
    const path = join(directory(), 'cancel.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const first = await recorder.beginRow(seed(), {
        id: 'first',
        submissionId: 'same',
      });
      const block = await recorder.beginBlock(first, 0);
      await recorder.appendField(block, new TextEncoder().encode('partial'));
      await recorder.finishAttempt(first, 'cancelled');
      expect(
        new TextDecoder().decode(await store.getState('attempt:first:outcome')),
      ).toContain('cancelled');
      const retry = await recorder.beginRow(seed(), {
        id: 'retry',
        submissionId: 'same',
      });
      expect(retry.transcriptId).toBeGreaterThan(first.transcriptId);
      const tail = await readTail(path);
      expect(new TextDecoder().decode(tail.rows[0].blocks[0])).toBe('partial');
      expect(tail.entries[0].status).toBe(2);
      expect(tail.members.every((member) => member.count === 0)).toBe(true);
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('marks orphaned acknowledged prefixes interrupted on owner resume', async () => {
    const path = join(directory(), 'resume.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    const row = await recorder.beginRow(seed(), {
      id: 'orphan',
      submissionId: 'prompt',
    });
    const block = await recorder.beginBlock(row, 0);
    await recorder.appendField(block, new TextEncoder().encode('survives'));
    await recorder.flush();
    await recorder.close();
    await store.close();
    const reopened = await JournalStore.open(path, storeDeps());
    try {
      const tail = await readTail(path);
      expect(tail.entries[0].status).toBe(4);
      expect(new TextDecoder().decode(tail.rows[0].blocks[0])).toBe('survives');
      expect(reopened.published?.rows).toBe(0);
    } finally {
      await reopened.close();
    }
  });

  it('retains chunk payload through compaction without retaining old trailers', async () => {
    const path = join(directory(), 'compact.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(seed(), {
        id: 'compact',
        submissionId: 'prompt',
      });
      const block = await recorder.beginBlock(row, 0);
      await recorder.appendField(block, new TextEncoder().encode('original'));
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      await recorder.close();
      await store.commit([{ kind: 'clear' }]);
      await store.compact();
      const tail = await readTail(path);
      expect(new TextDecoder().decode(tail.rows[0].blocks[0])).toBe('original');
    } finally {
      await recorder.close();
      await store.close();
    }
  });
});
