/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  chatsDirIn,
  journalSeams,
  PROJECT,
} from '../../recording/__tests__/support/recordedJournals.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { createHistoryStore } from './historyBackend.js';
import { HISTORY_BACKEND_ENV, selectBackend } from './historyBackendSelect.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { RecordingPort } from '../../recording/recordingPort.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';

const PORT_METHODS = [
  'onRetired',
  'isRecorder',
  'isAdoptingRecorder',
  'primaryOriginId',
  'adoptedOrigin',
  'journalPath',
  'attachJournal',
  'detachJournal',
  'adoptResume',
  'apply',
  'openPublication',
  'withPublicationOrdinals',
  'capturePublicationOwners',
  'mutationMark',
  'isCurrentMutationMark',
  'adoptMutationBoundary',
  'waitForDurable',
  'settleFanout',
  'waitForCommit',
  'getLength',
  'materialize',
  'streamRows',
  'lastContent',
  'readRows',
  'clear',
  'validateAndFix',
  'adoptMediaOwner',
  'removeTail',
  'reconcileMedia',
  'stageProfileReplacement',
  'mergeFrom',
  'optimizeDensity',
  'captureCompensation',
  'compensate',
  'publishDetached',
  'withCheckpoint',
  'withRollbackCheckpoint',
  'statistics',
  'contextRange',
  'openDumpSnapshot',
  'dispose',
] as const satisfies ReadonlyArray<keyof HistoryStorePort>;

// Fails to compile when the port gains a method this list does not name.
const everyPortMethodListed: Exclude<
  keyof HistoryStorePort,
  (typeof PORT_METHODS)[number] | 'clearIsAsynchronous'
> extends never
  ? true
  : false = true;

// Fails to compile when either store stops satisfying the port.
const bothStoresArePorts: [HistoryJournalStore, JournalHistoryStore] extends [
  HistoryStorePort,
  HistoryStorePort,
]
  ? true
  : false = true;

// Fails to compile when the recorder class stops providing the recording port.
const recorderIsARecordingPort: SessionRecordingService extends RecordingPort
  ? true
  : false = true;

describe('selectBackend', () => {
  it('defaults to the old backend when the variable is unset', () => {
    expect(selectBackend({})).toBe('old');
  });

  it('accepts old and journal', () => {
    expect(selectBackend({ [HISTORY_BACKEND_ENV]: 'old' })).toBe('old');
    expect(selectBackend({ [HISTORY_BACKEND_ENV]: 'journal' })).toBe('journal');
  });

  it.each(['jsonl', 'Journal', ' old', ''])(
    'rejects the unknown value %p and names the accepted ones',
    (value) => {
      expect(() => selectBackend({ [HISTORY_BACKEND_ENV]: value })).toThrow(
        /LLXPRT_HISTORY_BACKEND.*"old".*"journal"/,
      );
    },
  );

  describe('process environment', () => {
    const saved = process.env[HISTORY_BACKEND_ENV];
    afterEach(() => {
      if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
      else process.env[HISTORY_BACKEND_ENV] = saved;
    });

    it('reads the process environment when none is passed', () => {
      process.env[HISTORY_BACKEND_ENV] = 'journal';
      expect(selectBackend()).toBe('journal');
      delete process.env[HISTORY_BACKEND_ENV];
      expect(selectBackend()).toBe('old');
    });
  });
});

describe('createHistoryStore', () => {
  it('builds the old store, which provides every port method', async () => {
    expect(everyPortMethodListed).toBe(true);
    expect(recorderIsARecordingPort).toBe(true);
    expect(bothStoresArePorts).toBe(true);
    const store = createHistoryStore({}, 'old');
    try {
      expect(store).toBeInstanceOf(HistoryJournalStore);
      for (const method of PORT_METHODS)
        expect(typeof store[method]).toBe('function');
    } finally {
      await store.dispose();
    }
  });

  describe('the journal backend', () => {
    const directory = useTempDir('history-backend-journal-');
    const stores: HistoryStorePort[] = [];
    const recorders: Array<{ dispose(): Promise<void> }> = [];
    afterEach(async () => {
      for (const store of stores.splice(0)) await store.dispose();
      for (const recorder of recorders.splice(0))
        await recorder.dispose().catch(() => undefined);
    });

    function journalStore(
      ...args: Parameters<typeof createHistoryStore>
    ): HistoryStorePort {
      const store = createHistoryStore(args[0], args[1] ?? 'journal');
      stores.push(store);
      return store;
    }

    function journalRecorder(): JournalRecordingService {
      const created = JournalRecordingService.create({
        sessionId: 'backend-journal-recorder',
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

    it('builds the journal store, which provides every port method and opens itself', async () => {
      const store = journalStore({}, 'journal');
      expect(store).toBeInstanceOf(JournalHistoryStore);
      for (const method of PORT_METHODS)
        expect(typeof store[method]).toBe('function');
      expect(store.getLength()).toBe(0);
      store.apply({
        kind: 'content',
        content: { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      });
      await store.waitForCommit();
      expect(store.getLength()).toBe(1);
      expect(store.statistics().userMessages).toBe(1);
    });

    it('binds the recorder of the options once the journal is open', async () => {
      const recorder = journalRecorder();
      const store = journalStore({ recording: recorder }, 'journal');
      await store.waitForDurable();
      expect(store.isRecorder(recorder)).toBe(true);
    });

    it('refuses a recorder of the old backend at construction', () => {
      const jsonl = new SessionRecordingService({
        sessionId: 'backend-jsonl-recorder',
        projectHash: PROJECT,
        chatsDir: chatsDirIn(directory()),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      recorders.push(jsonl);
      expect(() => createHistoryStore({ recording: jsonl }, 'journal')).toThrow(
        /Recorder\/backend mismatch/,
      );
    });

    it('reports the rows its readers decode to the counters of the options', async () => {
      const { counters, snapshot } = createRowCounters();
      const store = journalStore({ attachmentCounters: counters }, 'journal');
      store.apply({
        kind: 'content',
        content: { speaker: 'human', blocks: [{ type: 'text', text: 'one' }] },
      });
      await store.waitForCommit();
      for await (const row of store.streamRows()) void row;
      expect(snapshot().rowsDecoded).toBe(1);
    });
  });
});
