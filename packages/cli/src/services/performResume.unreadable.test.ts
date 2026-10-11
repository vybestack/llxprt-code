/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: /continue style resume keeps working for healthy sessions while
 * an unreadable recording sits in the project, and names that recording when
 * the reference points at it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionRecordingService,
  type LockHandle,
  type SessionMetadata,
} from '@vybestack/llxprt-code-core';
import { performResume, type ResumeContext } from './performResume.js';

const PROJECT_HASH = 'perform-resume-unreadable';
const CORRUPT_REASON =
  'Invalid session_start: missing or malformed required fields';

async function writeHealthySession(
  chatsDir: string,
  sessionId: string,
): Promise<void> {
  const recording = new SessionRecordingService({
    chatsDir,
    sessionId,
    projectHash: PROJECT_HASH,
    workspaceDirs: [chatsDir],
    provider: 'test-provider',
    model: 'test-model',
  });
  try {
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
    });
    await recording.flush();
  } finally {
    await recording.dispose();
  }
}

async function writeCorruptSession(
  chatsDir: string,
  sessionId: string,
): Promise<string> {
  await mkdir(chatsDir, { recursive: true });
  const filePath = join(
    chatsDir,
    `session-2026-10-08T21-18-08-${sessionId}.jsonl`,
  );
  const header = {
    v: 1,
    seq: 1,
    ts: '2026-10-08T21:18:08.000Z',
    type: 'session_start',
    payload: {
      sessionId,
      projectHash: PROJECT_HASH,
      workspaceDirs: ['/x'],
      provider: 'anthropic',
      model: 42,
      startTime: '2026-10-08T21:18:08.000Z',
    },
  };
  await writeFile(filePath, `${JSON.stringify(header)}\n`, 'utf-8');
  return filePath;
}

describe('performResume with an unreadable recording present (issue #3732)', () => {
  let root: string;
  let chatsDir: string;
  let committed: SessionRecordingService | null;
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

    const result = await performResume('corrupt-session-0003', resumeContext());

    expect(result).toStrictEqual({
      ok: false,
      error: `Session not found for this project: corrupt-session-0003 (unreadable recording skipped: ${corruptPath}: ${CORRUPT_REASON})`,
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
      `Skipped unreadable session recording ${corruptPath}: ${CORRUPT_REASON}`,
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
      `Skipped unreadable session recording ${corruptPath}: ${CORRUPT_REASON}`,
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
      error: `No resumable sessions found (all locked, empty, or current). Skipped unreadable recordings: ${corruptPath}: ${CORRUPT_REASON}`,
    });
  });
});
