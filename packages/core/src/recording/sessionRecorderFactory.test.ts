/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from './journalRecordingService.js';
import type { SessionRecordingPort } from './recordingPort.js';
import {
  createLockedSessionRecorder,
  createSessionRecorder,
} from './sessionRecorderFactory.js';
import type { SessionRecordingServiceConfig } from './types.js';

describe('session recorder factory', () => {
  const directory = useTempDir('recorder-factory-');
  const live: SessionRecordingPort[] = [];
  afterEach(async () => {
    for (const recorder of live.splice(0)) await recorder.dispose();
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

  it('creates the journal recorder with the configured identity without a backend selection', () => {
    const recorder = createSessionRecorder(config('session-fac-0001'));
    live.push(recorder);
    expect(recorder).toBeInstanceOf(JournalRecordingService);
    expect(recorder.getSessionId()).toBe('session-fac-0001');
    expect(recorder.getProjectHash()).toBe('project');
    expect(recorder.ownsLockFor('session-fac-0001')).toBe(false);
  });

  it('creates a journal recorder holding the session lock', async () => {
    const recorder = await createLockedSessionRecorder(
      config('session-fac-0002'),
    );
    live.push(recorder);
    expect(recorder).toBeInstanceOf(JournalRecordingService);
    expect(recorder.ownsLockFor('session-fac-0002')).toBe(true);
    expect(recorder.getOwnedLockHandle()).not.toBeNull();
  });
});
