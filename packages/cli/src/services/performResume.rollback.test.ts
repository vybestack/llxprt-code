/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readRecordedRows } from '../__tests__/journal-recording.js';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

/**
 * #854: a resume that fails after the new recording was published must hand
 * the previous recording, integration, lock and metadata back through the
 * callbacks. The CLI must never be left holding a disposed recording.
 */

import {
  RecordingIntegration,
  SessionLockManager,
  createSessionRecorder,
  createLockedSessionRecorder,
  type IContent,
  type LockHandle,
  type ResumeBootHandle,
  type SessionMetadata,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performResume, type ResumeContext } from './performResume.js';

const PROJECT_HASH = 'perform-resume-rollback';
const CURRENT_SESSION = 'current-session-0001';
const TARGET_SESSION = 'target-session-0001';

class PublishThenFailHistory extends HistoryService {
  override adoptResumeBoot(
    recording: SessionRecordingPort,
    boot: ResumeBootHandle,
    afterPublication?: () => void | Promise<void>,
  ): Promise<string[]> {
    return super.adoptResumeBoot(recording, boot, async () => {
      await afterPublication?.();
      throw new Error('chronology records failed');
    });
  }
}

interface CliRecordingState {
  recording: SessionRecordingPort | null;
  integration: RecordingIntegration | null;
  lock: LockHandle | null;
  metadata: SessionMetadata | null;
}

function recordingConfig(chatsDir: string, sessionId: string) {
  return {
    chatsDir,
    sessionId,
    projectHash: PROJECT_HASH,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  };
}

function text(value: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text: value }] };
}

describe('performResume rollback after the new recording was published', () => {
  let root: string;
  let chatsDir: string;
  let previous: CliRecordingState;
  let state: CliRecordingState;
  let published: SessionRecordingPort[];
  let history: PublishThenFailHistory;
  let restoreFailure: Error | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'perform-resume-rollback-'));
    chatsDir = join(root, 'chats');
    await mkdir(chatsDir, { recursive: true });

    const target = createSessionRecorder(
      recordingConfig(chatsDir, TARGET_SESSION),
    );
    await recordRowsForTest(target, [text('target row')]);
    await target.flush();
    await target.dispose();

    const recording = await createLockedSessionRecorder(
      recordingConfig(chatsDir, CURRENT_SESSION),
    );
    await recordRowsForTest(recording, [text('current row')]);
    await recording.flush();
    previous = {
      recording,
      integration: new RecordingIntegration(recording),
      lock: await SessionLockManager.acquire(chatsDir, 'other-holder-0001'),
      metadata: {
        sessionId: CURRENT_SESSION,
        projectHash: PROJECT_HASH,
        provider: 'test-provider',
        model: 'test-model',
        workspaceDirs: [chatsDir],
        startTime: '2026-10-13T00:00:00.000Z',
        kind: 'main',
      },
    };
    state = { ...previous };
    published = [];
    history = new PublishThenFailHistory();
    restoreFailure = undefined;
  });

  afterEach(async () => {
    await history.dispose();
    await previous.integration?.dispose();
    await previous.recording?.dispose();
    await previous.lock?.release();
    await rm(root, { recursive: true, force: true });
  });

  function context(): ResumeContext {
    return {
      chatsDir,
      projectHash: PROJECT_HASH,
      currentSessionId: CURRENT_SESSION,
      currentProvider: 'test-provider',
      currentModel: 'test-model',
      workspaceDirs: [root],
      historyService: history,
      recordingCallbacks: {
        getCurrentRecording: () => state.recording,
        getCurrentIntegration: () => state.integration,
        getCurrentLockHandle: () => state.lock,
        getCurrentMetadata: () => state.metadata,
        setRecording: (recording, integration, lock, metadata) => {
          if (recording === previous.recording && restoreFailure !== undefined)
            throw restoreFailure;
          if (recording !== null && recording !== previous.recording)
            published.push(recording);
          state = { recording, integration, lock, metadata };
        },
      },
    };
  }

  it('restores the previous recording, integration, lock and metadata', async () => {
    const result = await performResume(TARGET_SESSION, context());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('chronology records failed');
    expect(published).toHaveLength(1);
    expect(state.recording).toBe(previous.recording);
    expect(state.integration).toBe(previous.integration);
    expect(state.lock).toBe(previous.lock);
    expect(state.metadata).toBe(previous.metadata);
    const recording = previous.recording;
    if (recording === null) throw new Error('Missing prior recording');
    await recordRowsForTest(recording, [text('after')]);
    const path = recording.getFilePath();
    if (path === null) throw new Error('Missing prior journal');
    expect((await readRecordedRows(path)).at(-1)?.blocks).toStrictEqual(
      text('after').blocks,
    );
  });

  it('reports a restore that itself fails instead of swallowing it', async () => {
    restoreFailure = new Error('restore callback rejected');

    const result = await performResume(TARGET_SESSION, context());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('chronology records failed');
    expect(result.error).toContain('rollback failed');
    expect(result.error).toContain('restore callback rejected');
  });
});
