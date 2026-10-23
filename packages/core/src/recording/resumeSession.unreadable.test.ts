/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, utimes, writeFile } from 'node:fs/promises';
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

  it('propagates a directory permission error instead of reporting lock contention', async () => {
    await healthy('locked-out-0010');
    await chmod(directory(), 0o500);
    try {
      await expect(resume(CONTINUE_LATEST)).rejects.toMatchObject({
        code: 'EACCES',
      });
      await expect(resume('locked-out-0010')).rejects.toMatchObject({
        code: 'EACCES',
      });
    } finally {
      await chmod(directory(), 0o700);
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
