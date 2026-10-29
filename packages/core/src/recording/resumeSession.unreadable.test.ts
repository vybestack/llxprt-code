/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { utimes, writeFile } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SessionDiscovery } from './SessionDiscovery.js';
import { denyWindowsAccess } from '@vybestack/llxprt-code-test-utils/windows-filesystem-denial.js';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { userRow } from './__tests__/support/recordedJournals.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  CONTINUE_LATEST,
  resumeSession,
  type ResumeResult,
} from './resumeSession.js';

interface NewEntryDenial {
  readonly restore: () => void;
  /** Lifts the denial, then rethrows `failure` (with token and ACL details on Windows). */
  readonly abort: (failure: unknown) => never;
}

/**
 * Makes `directory` refuse new entries for the current user. chmod(0500) does
 * nothing on Windows, where access is decided by the ACL, so Windows gets a
 * real deny entry instead, with the token's backup/restore privileges
 * switched off for as long as it is in place: an open that holds them skips
 * the directory checks that the lock path depends on.
 *
 * WD/AD are "add file" / "add subdirectory" on a directory, applied to this
 * directory only so the existing recording stays readable. FILE_ADD_FILE on
 * the directory is the right the lock path needs for both of its creating
 * operations: a CREATE_NEW open of the temp file (MS-FSA 2.1.5.1.1,
 * "Creation of a New File") and the hard link that publishes it (MS-FSA
 * FileLinkInformation, which opens the destination directory with
 * FILE_ADD_FILE). Callers verify the denial with those same operations
 * instead of assuming it.
 */
function denyNewEntries(directory: string): NewEntryDenial {
  if (process.platform === 'win32') {
    return denyWindowsAccess([{ target: directory, rights: 'WD,AD' }]);
  }
  chmodSync(directory, 0o500);
  const restore = (): void => chmodSync(directory, 0o700);
  return {
    restore,
    abort: (failure) => {
      restore();
      throw failure;
    },
  };
}

// libuv reports ERROR_ACCESS_DENIED as EPERM, POSIX reports EACCES.
const DENIED_CODE = process.platform === 'win32' ? 'EPERM' : 'EACCES';

/**
 * Proves `directory` refuses the two operations SessionLockManager uses to
 * publish a lock: an exclusive create of a temp file and a hard link of an
 * existing file into the directory. A plain writeFile denial is not enough,
 * because the lock path never calls writeFile.
 */
async function expectLockPublicationDenied(
  directory: string,
  existingFile: string,
): Promise<void> {
  const exclusive = await settle(
    fs.open(path.join(directory, 'probe-exclusive'), 'wx'),
  );
  if ('resolved' in exclusive) await exclusive.resolved.close();
  expect(exclusive).toMatchObject({ rejected: { code: DENIED_CODE } });
  expect(
    await settle(fs.link(existingFile, path.join(directory, 'probe-link'))),
  ).toMatchObject({ rejected: { code: DENIED_CODE } });
  expect(
    await settle(fs.mkdir(path.join(directory, 'probe-directory'))),
  ).toMatchObject({ rejected: { code: DENIED_CODE } });
}

async function settle<T>(
  promise: Promise<T>,
): Promise<{ resolved: T } | { rejected: unknown }> {
  try {
    return { resolved: await promise };
  } catch (error: unknown) {
    return { rejected: error };
  }
}

const PROJECT_HASH = 'resume-unreadable-project';

describe('resumeSession isolates unreadable recordings', () => {
  const directory = useTempDir('resume-3732-');
  const resumed: ResumeResult[] = [];
  afterEach(async () => {
    for (const result of resumed.splice(0)) await result.recording.dispose();
  });

  async function healthy(
    sessionId: string,
    provider = 'anthropic',
    model = 'claude-4',
  ): Promise<string> {
    const recording = JournalRecordingService.create({
      sessionId,
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      workspaceDirs: ['/test/workspace'],
      provider,
      model,
    });
    try {
      await (
        await recording.session()
      ).append([
        userRow(`hello from ${sessionId}`),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'reply' }] },
      ]);
      await recording.flush();
      const file = recording.getFilePath();
      if (file === null) throw new Error('Missing journal recording');
      return file;
    } finally {
      await recording.dispose();
    }
  }

  async function retired(sessionId: string): Promise<string> {
    const file = join(directory(), `session-${sessionId}.jsonl`);
    await writeFile(file, '{"v":99,"type":"session_start"}\n');
    return file;
  }

  function resume(continueRef: string): ReturnType<typeof resumeSession> {
    return resumeSession({
      continueRef,
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      currentProvider: 'claudecode',
      currentModel: 'claude-opus-5-5',
      workspaceDirs: ['/test/workspace'],
    });
  }

  async function resumeOk(continueRef: string): Promise<ResumeResult> {
    const result = await resume(continueRef);
    if (!result.ok) throw new Error(`resume failed: ${result.error}`);
    resumed.push(result);
    return result;
  }

  it('resumes a journal with an unknown provider by explicit session ID', async () => {
    await healthy('unknown-explicit-0001', 'unknown', 'unknown');
    const result = await resumeOk('unknown-explicit-0001');
    expect({
      sessionId: result.metadata.sessionId,
      provider: result.metadata.provider,
      model: result.metadata.model,
      historyLength: (await Array.fromAsync(result.boot.streamRows())).length,
    }).toStrictEqual({
      sessionId: 'unknown-explicit-0001',
      provider: 'unknown',
      model: 'unknown',
      historyLength: 2,
    });
    const file = result.recording.getFilePath();
    if (file === null) throw new Error('Missing resumed journal');
    expect(
      (await readJournalSnapshot(file, PROJECT_HASH)).metadata,
    ).toMatchObject({
      provider: 'claudecode',
      model: 'claude-opus-5-5',
    });
  });

  it('resumes the newest unknown-provider journal for bare continue', async () => {
    await healthy('older-healthy-0001');
    const file = await healthy('unknown-newest-0001', 'unknown', 'unknown');
    const when = new Date('2030-01-01T00:00:00.000Z');
    await utimes(file, when, when);
    expect((await resumeOk(CONTINUE_LATEST)).metadata.sessionId).toBe(
      'unknown-newest-0001',
    );
  });

  it('skips a newest unreadable candidate and resumes the next readable session', async () => {
    const file = await healthy('older-healthy-0002');
    const older = new Date('2030-01-01T00:00:00.000Z');
    await utimes(file, older, older);
    const corrupt = await retired('newest-corrupt-0002');
    const newer = new Date('2031-01-01T00:00:00.000Z');
    await utimes(corrupt, newer, newer);
    expect((await resumeOk(CONTINUE_LATEST)).metadata.sessionId).toBe(
      'older-healthy-0002',
    );
  });

  it('leaves skipped unreadable candidates unlocked', async () => {
    await healthy('older-healthy-0003');
    await retired('newest-corrupt-0003');
    await resumeOk(CONTINUE_LATEST);
    expect({
      corruptLocked: await SessionLockManager.isLocked(
        directory(),
        'newest-corrupt-0003',
      ),
      resumedLocked: await SessionLockManager.isLocked(
        directory(),
        'older-healthy-0003',
      ),
    }).toStrictEqual({ corruptLocked: false, resumedLocked: true });
  });

  it('names the file and reason without holding a lock when every candidate is unreadable', async () => {
    const file = await retired('only-unsupported-0004');
    const result = await resume(CONTINUE_LATEST);
    expect({
      outcome: result.ok
        ? 'resumed'
        : {
            error: result.error.includes(retiredJournalMessage(file)),
            skipped: result.skippedRecordings?.map(
              (recording) => recording.filePath,
            ),
          },
      locked: await SessionLockManager.isLocked(
        directory(),
        'only-unsupported-0004',
      ),
    }).toStrictEqual({
      outcome: { error: true, skipped: [file] },
      locked: false,
    });
  });

  it('reports the complete refusal when the only file is retired', async () => {
    const file = await retired('only-corrupt-0004');
    const result = await resume(CONTINUE_LATEST);
    expect(
      result.ok
        ? 'resumed'
        : { error: result.error, skipped: result.skippedRecordings },
    ).toStrictEqual({
      error: `No sessions found for this project; skipped unreadable recordings: ${file}: ${retiredJournalMessage(file)}`,
      skipped: [{ filePath: file, reason: retiredJournalMessage(file) }],
    });
  });

  it('reports every unreadable recording on a successful bare resume', async () => {
    await healthy('older-healthy-0006');
    const unsupported = await retired('newest-unsupported-0006');
    const corrupt = await retired('corrupt-header-0006');
    const result = await resumeOk(CONTINUE_LATEST);
    expect({
      resumed: result.metadata.sessionId,
      skipped: result.skippedRecordings
        .map((recording) => recording.filePath)
        .sort(),
    }).toStrictEqual({
      resumed: 'older-healthy-0006',
      skipped: [corrupt, unsupported].sort(),
    });
  });

  it('reports unreadable recordings on a successful explicit resume', async () => {
    await healthy('healthy-0007');
    const file = await retired('corrupt-header-0007');
    expect((await resumeOk('healthy-0007')).skippedRecordings).toStrictEqual([
      { filePath: file, reason: retiredJournalMessage(file) },
    ]);
  });

  it('reports no skipped recordings when every recording is readable', async () => {
    await healthy('healthy-0008');
    expect((await resumeOk(CONTINUE_LATEST)).skippedRecordings).toStrictEqual(
      [],
    );
  });

  it('fails an explicit unreadable file reference without falling back to healthy sessions', async () => {
    await healthy('older-healthy-0005');
    const file = await retired('explicit-unsupported-0005');
    const result = await resume(file);
    expect(result.ok ? 'resumed' : result.error).toBe(
      retiredJournalMessage(file),
    );
  });

  it('names the refusal reason for an explicitly named unreadable file', async () => {
    await healthy('older-healthy-0009');
    const file = await retired('explicit-corrupt-0009');
    const result = await resume('session-explicit-corrupt-0009.jsonl');
    expect(result.ok ? 'resumed' : result.error).toBe(
      retiredJournalMessage(file),
    );
  });

  it('propagates the permission error instead of reporting lock contention', async () => {
    const recordingPath = await healthy('locked-out-0010');
    const denial = denyNewEntries(directory());
    try {
      try {
        await expect(
          fs.writeFile(path.join(directory(), 'probe'), ''),
        ).rejects.toMatchObject({ code: DENIED_CODE });
        await expectLockPublicationDenied(directory(), recordingPath);
      } catch (error: unknown) {
        denial.abort(error);
      }
      const discovered = await SessionDiscovery.listSessionsDetailed(
        directory(),
        PROJECT_HASH,
      );
      expect({
        sessions: discovered.sessions.map((session) => session.sessionId),
        unreadable: discovered.unreadableRecordings,
      }).toStrictEqual({ sessions: ['locked-out-0010'], unreadable: [] });
      await expect(
        SessionLockManager.acquire(directory(), 'locked-out-0010'),
      ).rejects.toMatchObject({ code: DENIED_CODE });
      expect(await settle(resume(CONTINUE_LATEST))).toMatchObject({
        rejected: { code: DENIED_CODE },
      });
      expect(await settle(resume('locked-out-0010'))).toMatchObject({
        rejected: { code: DENIED_CODE },
      });
    } finally {
      denial.restore();
    }
  });

  it('reports contention when another process holds the session lock', async () => {
    await healthy('contended-0011');
    const holder = await SessionLockManager.acquire(
      directory(),
      'contended-0011',
    );
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
