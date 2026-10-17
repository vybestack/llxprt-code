/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import {
  chatsDirIn,
  journalSeams,
  PROJECT,
} from '../../recording/__tests__/support/recordedJournals.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { createHistoryStore } from './historyBackend.js';
import { HistoryService } from './HistoryService.js';
import type {
  HistoryMergeRequest,
  HistoryStorePort,
} from './historyStorePort.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

/** The members this file drives, which the journal store shares with the port. */
type Store = Pick<
  HistoryStorePort,
  | 'apply'
  | 'statistics'
  | 'contextRange'
  | 'waitForCommit'
  | 'isRecorder'
  | 'isAdoptingRecorder'
  | 'attachJournal'
  | 'detachJournal'
  | 'dispose'
>;

describe.each(['old', 'journal'] as const)(
  'HistoryStorePort scalars and recorder binding (%s store)',
  (backend) => {
    const directory = useTempDir('history-port-recorders-');
    const open: Store[] = [];
    const recorders: Array<{ dispose(): Promise<void> }> = [];
    afterEach(async () => {
      for (const store of open.splice(0)) await store.dispose();
      for (const recorder of recorders.splice(0))
        await recorder.dispose().catch(() => undefined);
    });

    async function opened(): Promise<Store> {
      const store: Store =
        backend === 'old'
          ? createHistoryStore({}, 'old')
          : new JournalHistoryStore(
              await JournalSession.create(
                path.join(directory(), 'recorders.llxj'),
                { journal: testJournalSeams({}).dependencies },
              ),
            );
      open.push(store);
      return store;
    }

    function journalRecorder(): JournalRecordingService {
      const created = JournalRecordingService.create({
        sessionId: 'port-journal-recorder',
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

    function jsonlRecorder(): SessionRecordingService {
      const created = new SessionRecordingService({
        sessionId: 'port-jsonl-recorder',
        projectHash: PROJECT,
        chatsDir: chatsDirIn(directory()),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      recorders.push(created);
      return created;
    }

    it('serves the statistics of the rows once they are committed', async () => {
      const store = await opened();
      store.apply({ kind: 'content', content: row('human', 'one', 1) });
      store.apply({ kind: 'content', content: row('ai', 'two', 2) });
      await store.waitForCommit();
      expect(store.statistics()).toStrictEqual({
        totalMessages: 2,
        userMessages: 1,
        aiMessages: 1,
        toolCalls: 0,
        toolResponses: 0,
      });
    });

    it('joins the chronology boundary with the spans the caller accumulated', async () => {
      const store = await opened();
      store.apply({ kind: 'content', content: row('human', 'one', 5) });
      store.apply({ kind: 'content', content: row('ai', 'two', 9) });
      await store.waitForCommit();
      const spans = [
        { start: 6, end: 7, reason: 'density-removed' as const },
        { start: 2, end: 3, reason: 'cleared' as const },
      ];
      expect(store.contextRange(spans)).toStrictEqual({
        firstSeq: 5,
        lastSeq: 9,
        totalEntries: 2,
        approximate: false,
        removedInterior: [
          { start: 2, end: 3, reason: 'cleared' },
          { start: 6, end: 7, reason: 'density-removed' },
        ],
      });
    });

    it('refuses a recorder of the other backend at every binding member', async () => {
      const store = await opened();
      const foreign = backend === 'old' ? journalRecorder() : jsonlRecorder();
      expect(() => store.isRecorder(foreign)).toThrow(
        /Recorder\/backend mismatch/,
      );
      expect(() => store.isAdoptingRecorder(foreign)).toThrow(
        /Recorder\/backend mismatch/,
      );
      await expect(
        Promise.resolve().then(() => store.attachJournal(foreign)),
      ).rejects.toThrow(/Recorder\/backend mismatch/);
      await expect(
        Promise.resolve().then(() => store.detachJournal(foreign)),
      ).rejects.toThrow(/Recorder\/backend mismatch/);
    });
  },
);

describe('the old store and a journal recorder', () => {
  const directory = useTempDir('history-port-factory-');

  it('is refused when the store is built with it', async () => {
    const recorder = JournalRecordingService.create({
      sessionId: 'port-factory',
      projectHash: PROJECT,
      chatsDir: chatsDirIn(directory()),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      journal: journalSeams(),
    });
    try {
      expect(() => createHistoryStore({ recording: recorder }, 'old')).toThrow(
        /Recorder\/backend mismatch/,
      );
    } finally {
      await recorder.dispose().catch(() => undefined);
    }
  });
});

describe('merging into the old store', () => {
  const directory = useTempDir('history-port-merge-');

  it('refuses a source that is not an old store', async () => {
    const target = createHistoryStore({}, 'old');
    const source = new JournalHistoryStore(
      await JournalSession.create(path.join(directory(), 'source.llxj'), {
        journal: testJournalSeams({}).dependencies,
      }),
    );
    const service = new HistoryService();
    const request: HistoryMergeRequest = {
      source,
      host: service.detachedValues.host(),
      publish: () => Promise.reject(new Error('The merge must not publish')),
    };
    try {
      await expect(target.mergeFrom(request)).rejects.toThrow(
        /History backend mismatch/,
      );
    } finally {
      await target.dispose();
      await source.dispose();
      await service.dispose();
    }
  });
});
