/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: /continue style resume keeps working for healthy sessions while
 * an unreadable recording sits in the project, and names that recording when
 * the reference points at it.
 */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

import {
  createSessionRecorder,
  type LockHandle,
  type SessionMetadata,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performResume, type ResumeContext } from './performResume.js';

const PROJECT_HASH = 'perform-resume-unreadable';
function corruptReason(filePath: string): string {
  return `Session file ${filePath} was recorded in the retired JSONL journal format (versions 1 and 2) and cannot be resumed. Start a new session.`;
}

async function writeHealthySession(
  chatsDir: string,
  sessionId: string,
): Promise<void> {
  const recording = createSessionRecorder({
    chatsDir,
    sessionId,
    projectHash: PROJECT_HASH,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  try {
    await recordRowsForTest(recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
      },
    ]);
    await recording.flush();
  } finally {
    await recording.dispose();
  }
}

async function writeCorruptSession(
  chatsDir: string,
  sessionId: string,
): Promise<string> {
  const recording = createSessionRecorder({
    chatsDir,
    sessionId,
    projectHash: PROJECT_HASH,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  await recordRowsForTest(recording, [
    { speaker: 'human', blocks: [{ type: 'text', text: 'unreadable source' }] },
  ]);
  const filePath = recording.getFilePath();
  if (filePath === null) throw new Error('Missing unreadable recording');
  await recording.dispose();
  await writeFile(filePath, '{');
  return filePath;
}

describe('performResume with an unreadable recording present (issue #3732)', () => {
  let root: string;
  let chatsDir: string;
  let committed: SessionRecordingPort | null;
  let committedLock: LockHandle | null;
  let committedMetadata: SessionMetadata | null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'perform-resume-3732-'));
    chatsDir = join(root, 'chats');
    committed = null;
    committedLock = null;
    committedMetadata = null;
  });

  afterEach(async () => {
    await committed?.dispose();
    await committedLock?.release();
    await rm(root, { recursive: true, force: true });
  });

  function resumeContext(): ResumeContext {
    return {
      chatsDir,
      projectHash: PROJECT_HASH,
      currentSessionId: 'current-session',
      currentProvider: 'test-provider',
      currentModel: 'test-model',
      workspaceDirs: [root],
      recordingCallbacks: {
        getCurrentRecording: () => null,
        getCurrentIntegration: () => null,
        getCurrentLockHandle: () => null,
        getCurrentMetadata: () => null,
        setRecording: (recording, _integration, lock, metadata) => {
          committed = recording;
          committedLock = lock;
          committedMetadata = metadata;
        },
      },
    };
  }

  it('resumes a healthy session by id', async () => {
    await writeHealthySession(chatsDir, 'healthy-session-0001');
    await writeCorruptSession(chatsDir, 'corrupt-session-0001');

    const result = await performResume('healthy-session-0001', resumeContext());

    expect({
      ok: result.ok,
      committedSessionId: committedMetadata?.sessionId,
    }).toStrictEqual({ ok: true, committedSessionId: 'healthy-session-0001' });
  });

  it('resumes the healthy session for latest', async () => {
    await writeHealthySession(chatsDir, 'healthy-session-0002');
    await writeCorruptSession(chatsDir, 'corrupt-session-0002');

    const result = await performResume('latest', resumeContext());

    expect({
      ok: result.ok,
      committedSessionId: committedMetadata?.sessionId,
    }).toStrictEqual({ ok: true, committedSessionId: 'healthy-session-0002' });
  });

  it('names the file and reason when the reference points at the unreadable recording', async () => {
    await writeHealthySession(chatsDir, 'healthy-session-0003');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-session-0003',
    );

    const result = await performResume(corruptPath, resumeContext());

    expect(result).toStrictEqual({
      ok: false,
      error: `Session not found for this project: ${corruptPath} (unreadable recording skipped: ${corruptPath}: ${corruptReason(corruptPath)})`,
    });
  });

  it('keeps the plain not-found error for a reference that matches nothing', async () => {
    await writeHealthySession(chatsDir, 'healthy-session-0004');
    await writeCorruptSession(chatsDir, 'corrupt-session-0004');

    const result = await performResume('no-such-session', resumeContext());

    expect(result).toStrictEqual({
      ok: false,
      error: 'Session not found for this project: no-such-session',
    });
  });

  it('warns about the unreadable recording on a successful resume', async () => {
    await writeHealthySession(chatsDir, 'healthy-session-0005');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-session-0005',
    );

    const result = await performResume('healthy-session-0005', resumeContext());

    expect(result.ok ? result.warnings : result.error).toStrictEqual([
      `Skipped unreadable session recording ${corruptPath}: ${corruptReason(corruptPath)}`,
    ]);
  });

  it('warns about the unreadable recording on a successful resume of the latest session', async () => {
    await writeHealthySession(chatsDir, 'healthy-session-0006');
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-session-0006',
    );

    const result = await performResume('latest', resumeContext());

    expect(result.ok ? result.warnings : result.error).toStrictEqual([
      `Skipped unreadable session recording ${corruptPath}: ${corruptReason(corruptPath)}`,
    ]);
  });

  it('names the skipped recording when nothing readable is left to resume', async () => {
    const corruptPath = await writeCorruptSession(
      chatsDir,
      'corrupt-session-0007',
    );

    const result = await performResume('latest', resumeContext());

    expect(result).toStrictEqual({
      ok: false,
      error: `No resumable sessions found (all locked, empty, or current). Skipped unreadable recordings: ${corruptPath}: ${corruptReason(corruptPath)}`,
    });
  });
});
