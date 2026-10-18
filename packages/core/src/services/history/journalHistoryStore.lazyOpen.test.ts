/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import {
  chatsDirIn,
  journalSeams,
  PROJECT,
} from '../../recording/__tests__/support/recordedJournals.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import type { JournalHistoryStoreOptions } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

async function texts(
  rows: AsyncIterable<IContent> | Promise<IContent[]>,
): Promise<string[]> {
  const out: string[] = [];
  for await (const content of await rows) out.push(textOf(content));
  return out;
}

/** A promise settled by hand, to hold the journal closed while operations arrive. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('JournalHistoryStore over an opener', () => {
  const directory = useTempDir('journal-history-lazy-');
  const stores: JournalHistoryStore[] = [];
  const recorders: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    for (const recorder of recorders.splice(0))
      await recorder.dispose().catch(() => undefined);
  });

  function lazyStore(
    opener: () => Promise<JournalSession>,
    options?: JournalHistoryStoreOptions,
  ): JournalHistoryStore {
    const store = new JournalHistoryStore(opener, options);
    stores.push(store);
    return store;
  }

  function journalRecorder(): JournalRecordingService {
    const created = JournalRecordingService.create({
      sessionId: 'lazy-open-recorder',
      projectHash: PROJECT,
      chatsDir: chatsDirIn(directory()),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      journal: journalSeams(),
    });
    recorders.push(created);
    return created;
  }

  it('accepts operations before the journal is open and applies them in order once it is', async () => {
    const gate = deferred<void>();
    let opens = 0;
    const store = lazyStore(async () => {
      opens += 1;
      await gate.promise;
      return JournalSession.createUnlinked();
    });

    expect(store.getLength()).toBe(0);
    expect(store.journalPath()).toBeNull();
    expect(store.statistics().totalMessages).toBe(0);
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    store.apply({ kind: 'content', content: row('ai', 'two', 2) });
    store.apply({ kind: 'content', content: row('human', 'three', 3) });
    expect(store.getLength()).toBe(3);
    let durable = false;
    const waiting = store.waitForDurable().then(() => {
      durable = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(durable).toBe(false);

    gate.resolve();
    await waiting;

    expect(opens).toBe(1);
    expect(await texts(store.streamRows())).toStrictEqual([
      'one',
      'two',
      'three',
    ]);
    expect(store.statistics().totalMessages).toBe(3);
    expect(store.journalPath()).toBeNull();
  });

  it('keeps a failure to open as the failure of the queue', async () => {
    const boom = new Error('cannot open the journal');
    const store = lazyStore(() => Promise.reject(boom));

    store.apply({ kind: 'content', content: row('human', 'lost', 1) });
    await expect(store.waitForDurable()).rejects.toBe(boom);
    expect(() =>
      store.apply({ kind: 'content', content: row('ai', 'later', 2) }),
    ).toThrow(boom);
    await expect(store.waitForDurable()).rejects.toBe(boom);
    await expect(store.settleFanout()).rejects.toBe(boom);
    await expect(store.materialize()).rejects.toBe(boom);
  });

  it('binds the recorder it was given once the journal is open, with the rows accepted before', async () => {
    const recorder = journalRecorder();
    const store = lazyStore(() => JournalSession.createUnlinked(), {
      recording: recorder,
    });
    expect(store.isRecorder(recorder)).toBe(false);
    store.apply({ kind: 'content', content: row('human', 'first', 1) });

    await store.waitForDurable();
    store.apply({ kind: 'content', content: row('ai', 'second', 2) });
    await store.waitForDurable();
    await store.settleFanout();

    expect(store.isRecorder(recorder)).toBe(true);
    const mirrored: string[] = [];
    for await (const { content } of (await recorder.session()).rows())
      mirrored.push(textOf(content));
    expect(mirrored).toStrictEqual(['first', 'second']);
  });

  it('fails the queue when the recorder it was given cannot be bound', async () => {
    const recorder = journalRecorder();
    const seeded = await recorder.session();
    await seeded.append([row('human', 'already here', 1)]);
    const store = lazyStore(() => JournalSession.createUnlinked(), {
      recording: recorder,
    });

    await expect(store.waitForDurable()).rejects.toThrow(/already holds rows/);
    expect(() =>
      store.apply({ kind: 'content', content: row('ai', 'later', 2) }),
    ).toThrow(/already holds rows/);
  });

  it('reports decoded and released rows of a stream and of a batch to the counters, with ownership', async () => {
    const { counters, snapshot } = createRowCounters();
    const ownership = new RowOwnership();
    const store = lazyStore(() => JournalSession.createUnlinked(), {
      counters: { ...counters, ownership },
    });
    for (let seq = 1; seq <= 4; seq += 1)
      store.apply({
        kind: 'content',
        content: row(seq % 2 === 1 ? 'human' : 'ai', `row ${seq}`, seq),
      });
    await store.waitForDurable();

    const seen: string[] = [];
    for await (const content of store.streamRows()) {
      seen.push(textOf(content));
      // The consumer holds exactly the row it was handed.
      expect(ownership.snapshot().liveRows).toBe(1);
    }
    expect(seen).toHaveLength(4);
    expect(snapshot().rowsDecoded).toBe(4);
    expect(snapshot().peakDecodedRows).toBe(1);
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(ownership.snapshot().acquisitions).toBe(4);

    const batch = await store.committedBatch(2);
    const batched: string[] = [];
    for await (const content of batch.rows()) batched.push(textOf(content));
    batch.retire();
    expect(batched).toStrictEqual(['row 3', 'row 4']);
    expect(snapshot().rowsDecoded).toBe(6);
    expect(ownership.snapshot().liveRows).toBe(0);
  });

  it('still takes an opened session, as the stores of earlier slices do', async () => {
    const session = await JournalSession.createUnlinked();
    const store = new JournalHistoryStore(session);
    stores.push(store);
    store.apply({ kind: 'content', content: row('human', 'direct', 1) });
    await store.waitForDurable();
    expect(await texts(store.materialize())).toStrictEqual(['direct']);
  });
});
