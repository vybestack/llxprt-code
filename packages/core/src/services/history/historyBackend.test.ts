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
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import { createHistoryStore } from './historyBackend.js';
import type { HistoryStorePort } from './historyStorePort.js';
import { JournalHistoryStore } from './journalHistoryStore.js';

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
  'hasPromptSubmission',
  'openResponseArrival',
  'flushCommitted',
  'getLength',
  'materialize',
  'streamRows',
  'appendDisplay',
  'retractDisplay',
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
  'currentTurnMarker',
  'contextRange',
  'openDumpSnapshot',
  'openSemanticPurgeSnapshot',
  'openCompressionInput',
  'openToolResponseRanking',
  'prepareCurated',
  'dispose',
] as const satisfies ReadonlyArray<keyof HistoryStorePort>;

// Fails to compile when the port gains a method this list does not name.
const everyPortMethodListed: Exclude<
  keyof HistoryStorePort,
  (typeof PORT_METHODS)[number] | 'clearIsAsynchronous' | 'compressionRowCount'
> extends never
  ? true
  : false = true;

// Fails to compile when the recorder class stops providing the recording port.
const recorderIsARecordingPort: JournalRecordingService extends SessionRecordingPort
  ? true
  : false = true;

describe('createHistoryStore', () => {
  it('creates journal history without selecting a backend', async () => {
    const store = createHistoryStore({});
    try {
      store.apply({
        kind: 'content',
        content: {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'default' }],
        },
      });
      await store.waitForCommit();
      expect(store.compressionRowCount()).toBe(1);
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
      const store = createHistoryStore(args[0]);
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
      expect(everyPortMethodListed).toBe(true);
      expect(recorderIsARecordingPort).toBe(true);
      const store = journalStore({});
      expect(store).toBeInstanceOf(JournalHistoryStore);
      for (const method of PORT_METHODS)
        expect(typeof store[method]).toBe('function');
      expect(store.getLength()).toBe(0);
      expect(store.compressionRowCount?.()).toBe(0);
      store.apply({
        kind: 'content',
        content: { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      });
      await store.waitForCommit();
      expect(store.getLength()).toBe(1);
      expect(store.compressionRowCount?.()).toBe(1);
      expect(store.statistics().userMessages).toBe(1);
    });

    it('binds the recorder of the options once the journal is open', async () => {
      const recorder = journalRecorder();
      const store = journalStore({ recording: recorder });
      await store.waitForDurable();
      expect(store.isRecorder(recorder)).toBe(true);
    });

    it('reports the rows its readers decode to the counters of the options', async () => {
      const { counters, snapshot } = createRowCounters();
      const store = journalStore({ attachmentCounters: counters });
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
