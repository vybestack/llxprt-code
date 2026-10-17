/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHistoryStore } from './historyBackend.js';
import { HISTORY_BACKEND_ENV, selectBackend } from './historyBackendSelect.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { RecordingPort } from '../../recording/recordingPort.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';

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
  (typeof PORT_METHODS)[number]
> extends never
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
    const store = createHistoryStore({}, 'old');
    try {
      expect(store).toBeInstanceOf(HistoryJournalStore);
      for (const method of PORT_METHODS)
        expect(typeof store[method]).toBe('function');
    } finally {
      await store.dispose();
    }
  });

  it('refuses the journal backend until its store exists', () => {
    expect(() => createHistoryStore({}, 'journal')).toThrow(
      /journal history backend is not implemented/,
    );
  });
});
