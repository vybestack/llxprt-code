/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: resuming legacy "unknown provider" recordings, and bare
 * continue skipping a newest candidate that fails replay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  resumeSession,
  CONTINUE_LATEST,
  type ResumeResult,
} from './resumeSession.js';
import {
  writeCorruptHeaderSession,
  writeLegacyUnknownProviderSession,
  writeUnsupportedVersionSession,
} from './__tests__/recording-file-fixtures.js';

const PROJECT_HASH = 'resume-unreadable-project';

async function createHealthySession(
  chatsDir: string,
  sessionId: string,
): Promise<string> {
  const recording = new SessionRecordingService({
    sessionId,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
  });
  recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
  });
  await recording.flush();
  const filePath = recording.getFilePath()!;
  await recording.dispose();
  return filePath;
}

async function setModifiedTime(filePath: string, iso: string): Promise<void> {
  const when = new Date(iso);
  await fs.utimes(filePath, when, when);
}

describe('resumeSession with legacy and unreadable recordings (issue #3732)', () => {
  let tempDir: string;
  let chatsDir: string;
  const resumed: ResumeResult[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-3732-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    for (const result of resumed.splice(0)) {
      await result.recording.dispose();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function resume(
    continueRef: string,
    overrides: { currentProvider?: string; currentModel?: string } = {},
  ): ReturnType<typeof resumeSession> {
    return resumeSession({
      continueRef,
      projectHash: PROJECT_HASH,
      chatsDir,
      currentProvider: overrides.currentProvider ?? 'claudecode',
      currentModel: overrides.currentModel ?? 'claude-opus-5-5',
      workspaceDirs: ['/test/workspace'],
    });
  }

  async function resumeOk(
    continueRef: string,
    overrides: { currentProvider?: string; currentModel?: string } = {},
  ): Promise<ResumeResult> {
    const result = await resume(continueRef, overrides);
    if (!result.ok) throw new Error(`resume failed: ${result.error}`);
    resumed.push(result);
    return result;
  }

  it('resumes a legacy unknown-provider recording by explicit session id', async () => {
    await writeLegacyUnknownProviderSession(chatsDir, {
      sessionId: 'legacy-explicit-0001',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await resumeOk('legacy-explicit-0001');

    expect({
      sessionId: result.metadata.sessionId,
      provider: result.metadata.provider,
      model: result.metadata.model,
      historyLength: result.history.length,
    }).toStrictEqual({
      sessionId: 'legacy-explicit-0001',
      provider: 'claudecode',
      model: 'claude-opus-5-5',
      historyLength: 2,
    });
  });

  it('resumes a legacy unknown-provider recording as the newest session for bare continue', async () => {
    await createHealthySession(chatsDir, 'older-healthy-0001');
    const legacy = await writeLegacyUnknownProviderSession(chatsDir, {
      sessionId: 'legacy-newest-0001',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });
    await setModifiedTime(legacy.filePath, '2030-01-01T00:00:00.000Z');

    const result = await resumeOk(CONTINUE_LATEST);

    expect(result.metadata.sessionId).toBe('legacy-newest-0001');
  });

  it('skips a newest candidate that fails replay and resumes the next readable session', async () => {
    const healthyPath = await createHealthySession(
      chatsDir,
      'older-healthy-0002',
    );
    await setModifiedTime(healthyPath, '2030-01-01T00:00:00.000Z');
    const corrupt = await writeUnsupportedVersionSession(chatsDir, {
      sessionId: 'newest-corrupt-0002',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });
    await setModifiedTime(corrupt.filePath, '2031-01-01T00:00:00.000Z');

    const result = await resumeOk(CONTINUE_LATEST);

    expect(result.metadata.sessionId).toBe('older-healthy-0002');
  });

  it('releases the lock taken on a skipped unreadable candidate', async () => {
    await createHealthySession(chatsDir, 'older-healthy-0003');
    const corrupt = await writeUnsupportedVersionSession(chatsDir, {
      sessionId: 'newest-corrupt-0003',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });
    await setModifiedTime(corrupt.filePath, '2031-01-01T00:00:00.000Z');

    await resumeOk(CONTINUE_LATEST);

    expect({
      corruptLocked: await SessionLockManager.isLocked(
        chatsDir,
        'newest-corrupt-0003',
      ),
      resumedLocked: await SessionLockManager.isLocked(
        chatsDir,
        'older-healthy-0003',
      ),
    }).toStrictEqual({ corruptLocked: false, resumedLocked: true });
  });

  it('fails naming the file and reason and holds no lock when every candidate fails replay', async () => {
    const unsupported = await writeUnsupportedVersionSession(chatsDir, {
      sessionId: 'only-unsupported-0004',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await resume(CONTINUE_LATEST);

    expect({
      outcome: result.ok
        ? 'resumed'
        : {
            error: result.error.includes('Unsupported recording version 99'),
            skipped: result.skippedRecordings?.map((r) => r.filePath),
          },
      locked: await SessionLockManager.isLocked(
        chatsDir,
        'only-unsupported-0004',
      ),
    }).toStrictEqual({
      outcome: { error: true, skipped: [unsupported.filePath] },
      locked: false,
    });
  });

  it('fails naming the file and reason when every recording has an unreadable header', async () => {
    const corrupt = await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'only-corrupt-0004',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await resume(CONTINUE_LATEST);

    expect(
      result.ok
        ? 'resumed'
        : {
            error: result.error,
            skipped: result.skippedRecordings,
          },
    ).toStrictEqual({
      error: `No sessions found for this project; skipped unreadable recordings: ${corrupt.filePath}: Invalid session_start: missing or malformed required fields`,
      skipped: [
        {
          sessionId: 'only-corrupt-0004',
          filePath: corrupt.filePath,
          reason: 'Invalid session_start: missing or malformed required fields',
        },
      ],
    });
  });

  it('reports the unreadable recordings on a successful bare resume', async () => {
    await createHealthySession(chatsDir, 'older-healthy-0006');
    const unsupported = await writeUnsupportedVersionSession(chatsDir, {
      sessionId: 'newest-unsupported-0006',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });
    const corrupt = await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-header-0006',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-07T21:18:08.000Z',
    });
    await setModifiedTime(unsupported.filePath, '2031-01-01T00:00:00.000Z');

    const result = await resumeOk(CONTINUE_LATEST);

    expect({
      resumed: result.metadata.sessionId,
      skipped: result.skippedRecordings
        .map((r) => r.filePath)
        .sort((a, b) => a.localeCompare(b)),
    }).toStrictEqual({
      resumed: 'older-healthy-0006',
      skipped: [corrupt.filePath, unsupported.filePath].sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  });

  it('reports the unreadable recordings on a successful explicit resume', async () => {
    await createHealthySession(chatsDir, 'healthy-0007');
    const corrupt = await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-header-0007',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await resumeOk('healthy-0007');

    expect(result.skippedRecordings).toStrictEqual([
      {
        sessionId: 'corrupt-header-0007',
        filePath: corrupt.filePath,
        reason: 'Invalid session_start: missing or malformed required fields',
      },
    ]);
  });

  it('reports no skipped recordings when every recording is readable', async () => {
    await createHealthySession(chatsDir, 'healthy-0008');

    const result = await resumeOk(CONTINUE_LATEST);

    expect(result.skippedRecordings).toStrictEqual([]);
  });

  it('still fails an explicit reference to a recording that fails replay without trying other sessions', async () => {
    await createHealthySession(chatsDir, 'older-healthy-0005');
    await writeUnsupportedVersionSession(chatsDir, {
      sessionId: 'explicit-unsupported-0005',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await resume('explicit-unsupported-0005');

    expect(result.ok ? 'resumed' : result.error).toMatch(
      /^Failed to replay session: Unsupported recording version 99/,
    );
  });

  it('fails an explicit reference to a recording with an unreadable header naming its reason', async () => {
    await createHealthySession(chatsDir, 'older-healthy-0009');
    await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'explicit-corrupt-0009',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await resume('explicit-corrupt-0009');

    expect(result.ok ? 'resumed' : result.error).toMatch(
      /^Failed to replay session: Invalid session_start/,
    );
  });

  describe('when the chats directory cannot be written', () => {
    afterEach(async () => {
      await fs.chmod(chatsDir, 0o700);
    });

    it('propagates the permission error instead of reporting lock contention', async () => {
      await createHealthySession(chatsDir, 'locked-out-0010');
      await fs.chmod(chatsDir, 0o500);

      await expect(resume(CONTINUE_LATEST)).rejects.toMatchObject({
        code: 'EACCES',
      });
      await expect(resume('locked-out-0010')).rejects.toMatchObject({
        code: 'EACCES',
      });
    });
  });

  it('reports contention when another process holds the session lock', async () => {
    await createHealthySession(chatsDir, 'contended-0011');
    const holder = await SessionLockManager.acquire(chatsDir, 'contended-0011');
    try {
      const bare = await resume(CONTINUE_LATEST);
      const explicit = await resume('contended-0011');

      expect({
        bare: bare.ok ? 'resumed' : bare.error,
        explicit: explicit.ok ? 'resumed' : explicit.error,
      }).toStrictEqual({
        bare: 'All sessions for this project are in use',
        explicit: 'Session is in use by another process',
      });
    } finally {
      await holder.release();
    }
  });
});
