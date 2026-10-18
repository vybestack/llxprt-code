/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HISTORY_BACKEND_ENV } from '../services/history/historyBackendSelect.js';
import { JournalRecordingService } from './journalRecordingService.js';
import type { SessionRecordingPort } from './recordingPort.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  createLockedSessionRecorder,
  createSessionRecorder,
} from './sessionRecorderFactory.js';
import type { SessionRecordingServiceConfig } from './types.js';

describe('session recorder factory', () => {
  const directory = useTempDir('recorder-factory-');
  const live: SessionRecordingPort[] = [];
  afterEach(async () => {
    for (const recorder of live.splice(0)) {
      await recorder.dispose().catch(() => undefined);
    }
  });

  function config(sessionId: string): SessionRecordingServiceConfig {
    return {
      sessionId,
      projectHash: 'project',
      chatsDir: path.join(directory(), 'chats'),
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
    };
  }

  const backends = [
    ['old', SessionRecordingService],
    ['journal', JournalRecordingService],
  ] as const;

  for (const [backend, recorderClass] of backends) {
    describe(`backend ${backend}`, () => {
      const env = { [HISTORY_BACKEND_ENV]: backend };

      it('createSessionRecorder builds that backend’s recorder with the configured identity', () => {
        const recorder = createSessionRecorder(config('session-fac-0001'), env);
        live.push(recorder);
        expect(recorder).toBeInstanceOf(recorderClass);
        expect(recorder.getSessionId()).toBe('session-fac-0001');
        expect(recorder.getProjectHash()).toBe('project');
        expect(recorder.ownsLockFor('session-fac-0001')).toBe(false);
      });

      it('createLockedSessionRecorder holds the session lock', async () => {
        const recorder = await createLockedSessionRecorder(
          config('session-fac-0002'),
          env,
        );
        live.push(recorder);
        expect(recorder).toBeInstanceOf(recorderClass);
        expect(recorder.ownsLockFor('session-fac-0002')).toBe(true);
        expect(recorder.getOwnedLockHandle()).not.toBeNull();
      });
    });
  }

  it('an unknown backend value fails fast', () => {
    expect(() =>
      createSessionRecorder(config('session-fac-0003'), {
        [HISTORY_BACKEND_ENV]: 'both',
      }),
    ).toThrow(/must be "old" or "journal"/);
  });
});
