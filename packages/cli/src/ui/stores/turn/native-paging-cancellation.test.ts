/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { JournalReaderDependencies } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

function gate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { enter, release, entered, released };
}

async function fixture(
  action: (
    file: string,
    ownership: RowOwnership,
    journal: JournalReaderDependencies,
    pause: ReturnType<typeof gate>,
    arm: () => void,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'native-page-cancel-'));
  const file = join(directory, 'journal.llxj');
  const session = await JournalSession.create(file);
  await session.append(
    [1, 2, 3].map((seq) => ({
      speaker: 'human',
      blocks: [{ type: 'text', text: `user${seq}` }],
      metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: 0 } },
    })),
  );
  await session.close();
  const ownership = new RowOwnership();
  const pause = gate();
  let armed = false;
  const journal: JournalReaderDependencies = {
    async open(path, flags) {
      const handle = await open(path, flags);
      return {
        fd: handle.fd,
        stat: () => handle.stat(),
        truncate: (length) => handle.truncate(length),
        close: () => handle.close(),
        write: (buffer, offset, length, position) =>
          handle.write(buffer, offset, length, position),
        writev: (buffers, position) => handle.writev(buffers, position),
        async read(buffer, offset, length, position) {
          if (armed) {
            armed = false;
            pause.enter();
            await pause.released;
          }
          return handle.read(buffer, offset, length, position);
        },
      };
    },
  };
  try {
    await action(file, ownership, journal, pause, () => {
      armed = true;
    });
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(await readdir(directory)).toStrictEqual(['journal.llxj']);
  } finally {
    pause.release();
    await rm(directory, { recursive: true, force: true });
  }
}

function counters(ownership: RowOwnership) {
  return { ...createRowCounters().counters, ownership };
}

describe('native paging controlled cancellation', () => {
  it('rejects an opening cancelled while the positional reader is paused', async () => {
    await fixture(async (file, ownership, journal, pause, arm) => {
      const controller = new AbortController();
      arm();
      const opening = NativeJournalCursor.open(file, {
        journal,
        signal: controller.signal,
        counters: counters(ownership),
      });
      const outcome = opening.then(
        async (cursor) => {
          await cursor.close();
          return 'published';
        },
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
      await pause.entered;
      controller.abort(new Error('cancel native open'));
      pause.release();
      expect(await outcome).toBe('cancel native open');
    });
  });

  for (const reverse of [true, false]) {
    it(`waits for a paused read on close without publishing its page, reverse=${reverse}`, async () => {
      await fixture(async (file, ownership, journal, pause, arm) => {
        const cursor = await NativeJournalCursor.open(
          file,
          { journal, counters: counters(ownership) },
          1,
        );
        let consumer: object | undefined;
        try {
          const first = (await cursor.pageBack(1)).entries[0];
          if (first.kind !== 'projected')
            throw new Error('Missing projected row');
          consumer = first.item;
          ownership.retain(consumer);
          if (!reverse) cursor.retainWindow(undefined, undefined, 'newer');
          arm();
          const pending = reverse ? cursor.pageBack(1) : cursor.pageForward(1);
          const outcome = pending.then(
            () => 'published',
            (error: unknown) =>
              error instanceof Error ? error.message : String(error),
          );
          await pause.entered;
          expect(
            ownership.within({ rows: 440, serializedBytes: 8_388_608 }),
          ).toBe(true);
          let closed = false;
          const closing = cursor.close().then(() => {
            closed = true;
          });
          await Promise.resolve();
          expect(closed).toBe(false);
          pause.release();
          await closing;
          expect(await outcome).toBe('Native journal cursor is closed');
          expect(ownership.snapshot().liveRows).toBe(1);
          await expect(cursor.pageBack(1)).rejects.toThrow(
            'Native journal cursor is closed',
          );
        } finally {
          pause.release();
          await cursor.close();
          if (consumer) ownership.release(consumer);
        }
      });
    });
  }
});
