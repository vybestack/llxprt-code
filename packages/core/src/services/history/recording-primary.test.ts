/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { RecordingIntegration } from '../../recording/RecordingIntegration.js';
import { HistoryService } from './HistoryService.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';
import type { IContent } from './IContent.js';
import {
  checkpointKey,
  parseCheckpointEntry,
} from '../../journal/checkpointDescriptor.js';

function row(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

async function rows(session: JournalSession): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const entry of session.rows()) result.push(entry.content);
  return result;
}

describe('recording as the native primary', () => {
  const directory = useTempDir('recording-primary-');
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
  });

  async function fixture(
    attach = true,
    recordingSeams?: ReturnType<typeof testJournalSeams>,
  ): Promise<{
    store: JournalHistoryStore;
    recorder: JournalRecordingService;
    primary: JournalSession;
    primaryFlushes(): number;
  }> {
    const seams = testJournalSeams();
    const primary = await JournalSession.createUnlinked({
      journal: seams.dependencies,
    });
    const store = new JournalHistoryStore(primary);
    const recorder = recording('a', recordingSeams);
    cleanup.push(
      () => recorder.dispose(),
      () => store.dispose(),
    );
    if (attach) await store.attachJournal(recorder, true, undefined, 'a');
    return {
      store,
      recorder,
      primary,
      primaryFlushes: () =>
        seams.events.filter((event) => event.type === 'flush').length,
    };
  }

  function recording(
    id: string,
    seams?: ReturnType<typeof testJournalSeams>,
  ): JournalRecordingService {
    return JournalRecordingService.create({
      sessionId: id,
      projectHash: 'project',
      chatsDir: join(directory(), 'chats'),
      workspaceDirs: ['/work'],
      provider: 'fake',
      model: 'fake',
      journal:
        seams === undefined ? undefined : { journal: seams.dependencies },
    });
  }

  it('writes an accepted group only to the recorder and keeps empty attachment lazy', async () => {
    const { store, recorder, primaryFlushes } = await fixture();
    expect(recorder.getFilePath()).toBeNull();
    const before = primaryFlushes();
    store.apply({
      kind: 'content',
      content: row('one durable copy'),
      origin: 'a',
    });
    await store.waitForCommit();
    expect(primaryFlushes() - before).toBe(0);
    expect(store.isAdoptingRecorder(recorder)).toBe(true);
    expect(await rows(await recorder.session())).toStrictEqual([
      row('one durable copy'),
    ]);
  });

  it('separates before foreign rows arrive and keeps late recorders filtered in both directions', async () => {
    const { store, recorder } = await fixture();
    store.apply({ kind: 'content', content: row('a1'), origin: 'a' });
    await store.waitForCommit();
    expect(store.isAdoptingRecorder(recorder)).toBe(true);
    const b = recording('b');
    cleanup.unshift(() => b.dispose());
    await store.attachJournal(b, true, undefined, 'b');
    store.apply({ kind: 'content', content: row('b1'), origin: 'b' });
    store.apply({ kind: 'content', content: row('shared') });
    store.apply({ kind: 'content', content: row('a2'), origin: 'a' });
    await store.waitForCommit();
    expect(store.isAdoptingRecorder(recorder)).toBe(false);
    expect(await store.materialize()).toStrictEqual([
      row('a1'),
      row('b1'),
      row('shared'),
      row('a2'),
    ]);
    expect(await rows(await recorder.session())).toStrictEqual([
      row('a1'),
      row('shared'),
      row('a2'),
    ]);
    expect(await rows(await b.session())).toStrictEqual([
      row('b1'),
      row('shared'),
    ]);
    await store.detachJournal(b);
    store.apply({ kind: 'content', content: row('b2'), origin: 'b' });
    await store.waitForCommit();
    expect(await rows(await recorder.session())).toStrictEqual([
      row('a1'),
      row('shared'),
      row('a2'),
    ]);
    expect(await store.materialize()).toHaveLength(5);
  });

  it('clones before stopping so later history cannot change the closed recording', async () => {
    const { store, recorder } = await fixture();
    store.apply({ kind: 'content', content: row('recorded'), origin: 'a' });
    await store.waitForCommit();
    expect(store.isAdoptingRecorder(recorder)).toBe(true);
    const file = recorder.getFilePath();
    if (file === null) throw new Error('missing recording');
    await store.detachJournal(recorder);
    await recorder.dispose();
    const before = await Bun.file(file).bytes();
    store.apply({ kind: 'content', content: row('not recorded'), origin: 'a' });
    await store.waitForCommit();
    expect(await store.materialize()).toStrictEqual([
      row('recorded'),
      row('not recorded'),
    ]);
    expect(await Bun.file(file).bytes()).toStrictEqual(before);
  });

  it('restores a saved mutation boundary after foreign-owner separation', async () => {
    const { store, recorder } = await fixture();
    store.apply({ kind: 'content', content: row('retained'), origin: 'a' });
    await store.waitForCommit();
    const mark = store.captureCompensation();
    store.apply({
      kind: 'content',
      content: row('rejected foreign'),
      origin: 'b',
    });
    await store.waitForCommit();
    try {
      await store.compensate(mark, undefined);
      await store.waitForCommit();
      expect(await store.materialize()).toStrictEqual([row('retained')]);
      expect(await rows(await recorder.session())).toStrictEqual([
        row('retained'),
      ]);
    } finally {
      await store.releaseCompensation(mark);
    }
  });

  it('does not take a foreign first-user preview after selection', async () => {
    const { store, recorder } = await fixture();
    store.apply({ kind: 'content', content: row('a assistant'), origin: 'a' });
    await store.waitForCommit();
    store.apply({
      kind: 'content',
      content: {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'b first user' }],
      },
      origin: 'b',
    });
    await store.waitForCommit();
    expect(
      await (await recorder.session()).store.getState('session:preview'),
    ).toBeUndefined();
    expect(await rows(await recorder.session())).toStrictEqual([
      row('a assistant'),
    ]);
  });

  it('keeps a single-owner streamed replacement on its recording primary', async () => {
    const { store, recorder, primaryFlushes } = await fixture();
    store.apply({ kind: 'content', content: row('before'), origin: 'a' });
    await store.waitForCommit();
    const before = primaryFlushes();
    await store.replaceFrom([row('summary')], 1, undefined, 'a');
    await store.waitForCommit();
    expect(store.isAdoptingRecorder(recorder)).toBe(true);
    expect(primaryFlushes()).toBe(before);
    expect(await rows(await recorder.session())).toStrictEqual([
      row('summary'),
    ]);
  });

  it('keeps the prior primary when subscription acceptance fails', async () => {
    const { store, recorder, primary } = await fixture(false);
    const refusal = new Error('subscription rejected');
    await expect(
      store.attachJournal(
        recorder,
        true,
        () => {
          throw refusal;
        },
        'a',
      ),
    ).rejects.toBe(refusal);
    store.apply({ kind: 'content', content: row('still usable'), origin: 'a' });
    await store.waitForCommit();
    expect(recorder.getFilePath()).toBeNull();
    expect(await rows(primary)).toStrictEqual([row('still usable')]);
    expect(store.isRecorder(recorder)).toBe(false);
  });

  it('retains a primary with existing foreign rows instead of adopting its filtered mirror', async () => {
    const { store, recorder, primary } = await fixture(false);
    store.apply({ kind: 'content', content: row('foreign'), origin: 'b' });
    store.apply({ kind: 'content', content: row('ours'), origin: 'a' });
    await store.waitForCommit();
    await store.attachJournal(recorder, true, undefined, 'a');
    store.apply({
      kind: 'content',
      content: row('later foreign'),
      origin: 'b',
    });
    await store.waitForCommit();
    expect(store.isAdoptingRecorder(recorder)).toBe(false);
    expect(await rows(primary)).toStrictEqual([
      row('foreign'),
      row('ours'),
      row('later foreign'),
    ]);
    expect(await rows(await recorder.session())).toStrictEqual([row('ours')]);
  });

  it('separates a foreign streamed replacement without storing it in the foreground recording', async () => {
    const { store, recorder } = await fixture();
    store.apply({ kind: 'content', content: row('ours'), origin: 'a' });
    await store.waitForCommit();
    const checkpoint = await recorder.createCheckpoint('before separation');
    recorder.recordSessionMetadata('preserved title');
    await recorder.flush();
    await store.replaceFrom([row('foreign summary')], 1, undefined, 'b');
    await store.waitForCommit();
    expect(await store.materialize()).toStrictEqual([row('foreign summary')]);
    expect(await rows(await recorder.session())).toStrictEqual([]);
    expect(recorder.getSessionMetadataTitle()).toBe('preserved title');
    const saved = await (
      await recorder.session()
    ).store.getState(checkpointKey(checkpoint.checkpointId));
    if (saved === undefined)
      throw new Error('Checkpoint lost during separation');
    expect(parseCheckpointEntry(saved)?.name).toBe('before separation');
  });

  it('leaves the adopted file unchanged when the separation clone fails', async () => {
    const failures: { failFlushAt?: number } = {};
    const seams = testJournalSeams(failures);
    const { store, recorder } = await fixture(true, seams);
    store.apply({ kind: 'content', content: row('ours'), origin: 'a' });
    await store.waitForCommit();
    const file = recorder.getFilePath();
    if (file === null) throw new Error('missing recording');
    const before = await Bun.file(file).bytes();
    failures.failFlushAt = seams.events.filter(
      (event) => event.type === 'flush',
    ).length;
    store.apply({ kind: 'content', content: row('foreign'), origin: 'b' });
    await expect(store.waitForCommit()).rejects.toThrow(
      'injected flush failure',
    );
    expect(store.isAdoptingRecorder(recorder)).toBe(true);
    expect(await Bun.file(file).bytes()).toStrictEqual(before);
    expect(await rows(await recorder.session())).toStrictEqual([row('ours')]);
    await store.detachJournal(recorder);
  });

  it('settles a failed sibling mirror before allocating a separation clone', async () => {
    const { store, recorder } = await fixture();
    store.apply({ kind: 'content', content: row('ours'), origin: 'a' });
    await store.waitForCommit();
    const failures: { failFlushAt?: number } = {};
    const seams = testJournalSeams(failures);
    const b = recording('b', seams);
    cleanup.unshift(() => b.dispose());
    await store.attachJournal(b, true, undefined, 'b');
    failures.failFlushAt = seams.events.filter(
      (event) => event.type === 'flush',
    ).length;
    store.apply({ kind: 'content', content: row('shared') });
    await store.waitForDurable();
    const active = new Set<JournalSession>();
    const clone = JournalSession.prototype.cloneUnlinked;
    const observer = spyOn(
      JournalSession.prototype,
      'cloneUnlinked',
    ).mockImplementation(async function (this: JournalSession, options) {
      const session = await clone.call(this, options);
      active.add(session);
      const close = session.close.bind(session);
      session.close = async (): Promise<void> => {
        await close();
        active.delete(session);
      };
      return session;
    });
    try {
      store.apply({ kind: 'content', content: row('foreign'), origin: 'b' });
      await expect(store.waitForCommit()).rejects.toThrow(
        'injected flush failure',
      );
      expect(store.isAdoptingRecorder(recorder)).toBe(true);
      expect(active.size).toBe(0);
      expect(() =>
        store.apply({ kind: 'content', content: row('must still fail') }),
      ).toThrow('injected flush failure');
      expect(await rows(await recorder.session())).toStrictEqual([
        row('ours'),
        row('shared'),
      ]);
    } finally {
      observer.mockRestore();
      for (const session of active) await session.close();
      await store.detachJournal(b);
      await store.detachJournal(recorder);
    }
  });

  it('uses real history and integration attachment for foreground selection', async () => {
    const recorder = recording('integration');
    const history = new HistoryService({ backend: 'journal' });
    const integration = new RecordingIntegration(recorder);
    cleanup.push(
      () => recorder.dispose(),
      () => history.dispose(),
      () => integration.dispose(),
    );
    const owner = {};
    await integration.subscribeToJournal(history, owner);
    history.add(row('foreground'), undefined, owner);
    await integration.flushAtTurnBoundary();
    const native = await recorder.session();
    const before = native.store.published?.commitSeq ?? 0;
    history.add(row('next'), undefined, owner);
    await integration.flushAtTurnBoundary();
    expect(native.store.published?.commitSeq).toBe(before + 1);
    expect(await rows(native)).toHaveLength(2);
  });
});
