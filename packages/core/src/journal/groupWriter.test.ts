/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { JournalWriterPoisonedError } from './errors.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { frameLength } from './frame.js';
import { openJournalReadOnly } from './journalReader.js';
import { createJournal } from './journalWriterOpen.js';
import { RECORD_KIND } from './recordKinds.js';
import { TRAILER_RECORD_BYTES } from './trailerRecord.js';
import {
  plainRecord,
  standardGroup,
  testJournalSeams,
  trailerStateFor,
  type JournalEvent,
} from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function onlyWritesAndFlushes(events: readonly JournalEvent[]): JournalEvent[] {
  return events.filter(
    (event) => event.type === 'write' || event.type === 'flush',
  );
}

/**
 * The index, among all writes to the file, of the trailer write of the first
 * standard group: the file header is write 0 and the trailer is the last one.
 */
async function trailerWriteIndex(directory: string): Promise<number> {
  const probe = testJournalSeams();
  const writer = await createJournal(
    path.join(directory, 'probe.llxj'),
    probe.dependencies,
  );
  await writer.commitGroup(standardGroup(1));
  await writer.close();
  return probe.events.filter((event) => event.type === 'write').length - 1;
}

describe('commit group order', () => {
  const tempDir = useTempDir('journal-writer-');

  it('writes the records, then flushes them, then writes the trailer last', async () => {
    const file = path.join(tempDir(), 'order.llxj');
    const { events, dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);
    events.length = 0;

    const ack = await writer.commitGroup(standardGroup(1));
    await writer.close();

    const trailerStart = ack.durableEnd - TRAILER_RECORD_BYTES;
    const steps = onlyWritesAndFlushes(events);
    const flushAt = steps.findIndex((step) => step.type === 'flush');
    const writesBefore = steps.slice(0, flushAt);
    const after = steps.slice(flushAt + 1);
    expect(steps.filter((step) => step.type === 'flush')).toHaveLength(1);
    expect(writesBefore.length).toBeGreaterThan(0);
    for (const step of writesBefore) {
      expect(step.type).toBe('write');
      expect(step.type === 'write' && step.position).toBeLessThan(trailerStart);
    }
    expect(after).toStrictEqual([
      { type: 'write', position: trailerStart, length: TRAILER_RECORD_BYTES },
    ]);
  });

  it('flushes once for each group however many records it holds', async () => {
    const file = path.join(tempDir(), 'per-group.llxj');
    const { events, dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);

    await writer.commitGroup(standardGroup(1));
    await writer.commitGroup(standardGroup(2));
    await writer.commitGroup({
      records: [],
      trailer: () => trailerStateFor(3, {}),
    });
    await writer.close();

    expect(events.filter((event) => event.type === 'flush')).toHaveLength(3);
  });

  it('writes the next group where the previous one ended', async () => {
    const file = path.join(tempDir(), 'contiguous.llxj');
    const { events, dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);

    const first = await writer.commitGroup(standardGroup(1));
    events.length = 0;
    await writer.commitGroup(standardGroup(2));
    await writer.close();

    const firstWrite = events.find((event) => event.type === 'write');
    expect(firstWrite).toStrictEqual({
      type: 'write',
      position: first.durableEnd,
      length: expect.any(Number),
    });
  });

  it('opens its descriptor read-write and never in append mode', async () => {
    const file = path.join(tempDir(), 'flags.llxj');
    const { events, dependencies } = testJournalSeams();

    const writer = await createJournal(file, dependencies);
    await writer.close();

    expect(events.filter((event) => event.type === 'open')).toStrictEqual([
      { type: 'open', flags: 'wx+' },
    ]);
  });
});

describe('the ack and the published state', () => {
  const tempDir = useTempDir('journal-ack-');

  it('names the commit sequence, the durable end and the group tag', async () => {
    const file = path.join(tempDir(), 'ack.llxj');
    const { dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);
    const group = standardGroup(1);
    const expectedEnd =
      JOURNAL_HEADER_BYTES +
      group.records.reduce(
        (sum, record) =>
          sum + frameLength(record.kindHeader.length, record.body?.length ?? 0),
        0,
      ) +
      TRAILER_RECORD_BYTES;

    const first = await writer.commitGroup(group);
    const second = await writer.commitGroup(standardGroup(2));
    await writer.close();

    expect(first.commitSeq).toBe(1);
    expect(first.durableEnd).toBe(expectedEnd);
    expect(first.groupTag).toBeGreaterThanOrEqual(0n);
    expect(first.groupTag).toBeLessThan(1n << 56n);
    expect(second.commitSeq).toBe(2);
    expect(second.groupTag).not.toBe(first.groupTag);
    expect((await fsp.stat(file)).size).toBe(second.durableEnd);
  });

  it('keeps the published state until the trailer write has returned', async () => {
    const file = path.join(tempDir(), 'gated.llxj');
    const { dependencies, release } = testJournalSeams({
      gateWriteAt: await trailerWriteIndex(tempDir()),
    });
    const writer = await createJournal(file, dependencies);

    const pending = writer.commitGroup(standardGroup(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const during = writer.published;
    release();
    const ack = await pending;
    const after = writer.published;
    await writer.close();

    expect(during).toBeUndefined();
    expect(after?.commitSeq).toBe(ack.commitSeq);
    expect(after?.durableEnd).toBe(ack.durableEnd);
    expect(after?.groupTag).toBe(ack.groupTag);
  });

  it('writes one group after another when commits are issued together', async () => {
    const file = path.join(tempDir(), 'queued.llxj');
    const { dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);

    const acks = await Promise.all([
      writer.commitGroup(standardGroup(1)),
      writer.commitGroup(standardGroup(2)),
      writer.commitGroup(standardGroup(3)),
    ]);
    await writer.close();

    expect(acks.map((ack) => ack.commitSeq)).toStrictEqual([1, 2, 3]);
    const reader = await openJournalReadOnly(file, dependencies);
    expect(reader.trailer?.commitSeq).toBe(3);
    await reader.close();
  });

  it('leaves the file and the published state alone when the trailer builder throws', async () => {
    const file = path.join(tempDir(), 'builder.llxj');
    const { events, dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);
    const before = (await fsp.stat(file)).size;
    events.length = 0;

    const failure = writer.commitGroup({
      records: [plainRecord(RECORD_KIND.ROW, 5, 10)],
      trailer: () => {
        throw new Error('builder failed');
      },
    });

    await expect(failure).rejects.toThrow('builder failed');
    expect(events).toStrictEqual([]);
    expect((await fsp.stat(file)).size).toBe(before);
    expect(writer.published).toBeUndefined();
    const ack = await writer.commitGroup(standardGroup(1));
    await writer.close();
    expect(ack.commitSeq).toBe(1);
  });
});

describe('a failed write or flush', () => {
  const tempDir = useTempDir('journal-poison-');

  it('writes no trailer when the flush fails, keeps the published state and poisons the writer', async () => {
    const file = path.join(tempDir(), 'flush-fails.llxj');
    const { events, dependencies } = testJournalSeams({ failFlushAt: 1 });
    const writer = await createJournal(file, dependencies);
    const first = await writer.commitGroup(standardGroup(1));
    events.length = 0;

    const failure = writer.commitGroup(standardGroup(2));

    await expect(failure).rejects.toThrow('injected flush failure');
    const afterFailure = onlyWritesAndFlushes(events);
    expect(afterFailure[afterFailure.length - 1]).toStrictEqual({
      type: 'flush',
      fd: expect.any(Number),
    });
    expect(writer.published?.commitSeq).toBe(first.commitSeq);
    events.length = 0;
    const later = writer.commitGroup(standardGroup(3));
    await expect(later).rejects.toBeInstanceOf(JournalWriterPoisonedError);
    expect(events).toStrictEqual([]);
    await writer.close();
    const reader = await openJournalReadOnly(file, dependencies);
    expect(reader.trailer?.commitSeq).toBe(1);
    expect(reader.trailer?.durableEnd).toBe(first.durableEnd);
    await reader.close();
  });

  it('poisons the writer when a record write fails', async () => {
    const file = path.join(tempDir(), 'record-fails.llxj');
    // Write 0 is the file header; write 1 is the first write of the first group.
    const { events, dependencies } = testJournalSeams({ failWriteAt: 1 });
    const writer = await createJournal(file, dependencies);

    await expect(writer.commitGroup(standardGroup(1))).rejects.toThrow(
      'injected write failure',
    );
    events.length = 0;

    await expect(writer.commitGroup(standardGroup(2))).rejects.toBeInstanceOf(
      JournalWriterPoisonedError,
    );
    expect(events).toStrictEqual([]);
    expect(writer.published).toBeUndefined();
    await writer.close();
  });

  it('poisons the writer and publishes nothing when the trailer write fails', async () => {
    const file = path.join(tempDir(), 'trailer-fails.llxj');
    const { dependencies } = testJournalSeams({
      failWriteAt: await trailerWriteIndex(tempDir()),
    });
    const writer = await createJournal(file, dependencies);

    await expect(writer.commitGroup(standardGroup(1))).rejects.toThrow(
      'injected write failure',
    );

    expect(writer.published).toBeUndefined();
    await expect(writer.commitGroup(standardGroup(2))).rejects.toBeInstanceOf(
      JournalWriterPoisonedError,
    );
    await writer.close();
    const reader = await openJournalReadOnly(file, dependencies);
    expect(reader.trailer).toBeUndefined();
    await reader.close();
  });

  it('poisons the writer when a body is shorter than it declared', async () => {
    const file = path.join(tempDir(), 'short-body.llxj');
    const { dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);

    await expect(
      writer.commitGroup({
        records: [
          {
            kind: RECORD_KIND.ROW,
            kindHeader: new Uint8Array(8),
            body: { length: 10, chunks: [new Uint8Array(4)] },
          },
        ],
        trailer: () => trailerStateFor(1, {}),
      }),
    ).rejects.toThrow('shorter');

    await expect(writer.commitGroup(standardGroup(2))).rejects.toBeInstanceOf(
      JournalWriterPoisonedError,
    );
    await writer.close();
  });

  it('refuses a commit after close', async () => {
    const file = path.join(tempDir(), 'closed.llxj');
    const { dependencies } = testJournalSeams();
    const writer = await createJournal(file, dependencies);
    await writer.close();

    await expect(writer.commitGroup(standardGroup(1))).rejects.toThrow(
      'closed',
    );
  });
});
