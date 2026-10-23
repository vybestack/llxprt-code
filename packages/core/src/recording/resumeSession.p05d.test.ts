/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { appendFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import {
  resumeSession,
  CONTINUE_LATEST,
  type ResumeRequest,
} from './resumeSession.js';
import { requireJournalRecorder } from '../services/history/recorderBackend.js';
import type { SessionRecordingPort } from './recordingPort.js';
import { SessionLockManager } from './SessionLockManager.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  LARGE_N,
  PAGE_BOUND,
  PROJECT_HASH,
  SMALL_N,
  seedRecording,
  requireBoot,
  textRow,
  rowTexts,
  useJournalReadProbe,
} from './__tests__/support/journalRecordingFixture.js';

describe('bounded native journal resume', () => {
  const directory = useTempDir('resume-native-');
  const probe = useJournalReadProbe();
  const recordings: SessionRecordingPort[] = [];
  afterEach(async () => {
    for (const recording of recordings.splice(0)) await recording.dispose();
  });
  async function resume(
    overrides: Partial<ResumeRequest> = {},
  ): ReturnType<typeof resumeSession> {
    const result = await resumeSession({
      continueRef: CONTINUE_LATEST,
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      currentProvider: 'test',
      currentModel: 'model',
      workspaceDirs: ['/test/workspace'],
      ...overrides,
    });
    if (result.ok) recordings.push(result.recording);
    return result;
  }

  for (const count of [SMALL_N, LARGE_N]) {
    it(`boots ${count} rows without an array and bounds descriptor reads before streaming`, async () => {
      const seed = await seedRecording(directory(), count, { name: 'boots' });
      probe().reset();
      const result = await resume({
        continueRef: seed.recording.getSessionId(),
      });
      const boot = requireBoot(result);
      if (!result.ok) throw new Error(result.error);
      expect('history' in result).toBe(false);
      expect(result.metadata.sessionId).toBe(seed.recording.getSessionId());
      expect(result.recording.getFilePath()).toBe(seed.filePath);
      expect(result.recording.isActive()).toBe(true);
      expect(probe().decodedRows).toBe(0);
      expect(probe().reads).toBeGreaterThan(0);
      expect(probe().reads).toBeLessThanOrEqual(PAGE_BOUND);
      const rows = await Array.fromAsync(boot.streamRows());
      expect(rows).toStrictEqual(seed.contents);
      expect(probe().decodedRows).toBe(count);
      expect(probe().peakReads).toBeLessThanOrEqual(PAGE_BOUND);
      expect(probe().activeReads).toBe(0);
    }, 60_000);
  }
  it('ignores a torn native tail while retaining the complete version', async () => {
    const seed = await seedRecording(directory(), 3);
    await appendFile(seed.filePath, new Uint8Array([1, 1, 0]));
    const result = await resume({ continueRef: seed.recording.getSessionId() });
    expect(
      await Array.fromAsync(requireBoot(result).streamRows()),
    ).toStrictEqual(seed.contents);
  });
  it('appends to the original journal with a strictly newer commit sequence', async () => {
    const seed = await seedRecording(directory(), 2);
    const before = await readJournalSnapshot(seed.filePath, PROJECT_HASH);
    const result = await resume({ continueRef: seed.recording.getSessionId() });
    requireBoot(result);
    if (!result.ok) throw new Error(result.error);
    await (
      await requireJournalRecorder(result.recording).session()
    ).append([textRow('post-resume')]);
    await result.recording.flush();
    const after = await readJournalSnapshot(seed.filePath, PROJECT_HASH);
    expect(result.recording.getFilePath()).toBe(seed.filePath);
    expect(after.commitSeq).toBeGreaterThan(before.commitSeq);
    expect(rowTexts(after.history)).toStrictEqual([
      'row-0',
      'row-1',
      'post-resume',
    ]);
  });
  it('resumes the newest eligible session for bare continue', async () => {
    const older = await seedRecording(directory());
    const newest = await seedRecording(directory());
    await utimes(older.filePath, 1e9, 1e9);
    await utimes(newest.filePath, 2e9, 2e9);
    const result = await resume();
    requireBoot(result);
    if (!result.ok) throw new Error(result.error);
    expect(result.metadata.sessionId).toBe(newest.recording.getSessionId());
  });
  it('resumes the Nth newest session by index', async () => {
    const older = await seedRecording(directory());
    const newest = await seedRecording(directory());
    await utimes(older.filePath, 1e9, 1e9);
    await utimes(newest.filePath, 2e9, 2e9);
    const result = await resume({ continueRef: '2' });
    requireBoot(result);
    if (!result.ok) throw new Error(result.error);
    expect(result.metadata.sessionId).toBe(older.recording.getSessionId());
  });
  it('refuses a retired JSONL reference with the required format error', async () => {
    const file = join(directory(), 'session-retired.jsonl');
    await writeFile(file, '{"v":1,"seq":1,"type":"session_start"}\n');
    const result = await resume({ continueRef: file });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('cannot be resumed'),
    });
  });
  it('boots an explicit empty native session with zero rows', async () => {
    const seed = await seedRecording(directory(), 0);
    const result = await resume({ continueRef: seed.recording.getSessionId() });
    expect(
      await Array.fromAsync(requireBoot(result).streamRows()),
    ).toStrictEqual([]);
  });
  it('refuses an explicit locked session and skips it for bare continue', async () => {
    const older = await seedRecording(directory());
    const newest = await seedRecording(directory());
    await utimes(older.filePath, 1e9, 1e9);
    await utimes(newest.filePath, 2e9, 2e9);
    const lock = await SessionLockManager.acquire(
      directory(),
      newest.recording.getSessionId(),
    );
    try {
      expect(
        await resume({ continueRef: newest.recording.getSessionId() }),
      ).toMatchObject({ ok: false, error: expect.stringContaining('in use') });
      const result = await resume();
      requireBoot(result);
      if (!result.ok) throw new Error(result.error);
      expect(result.metadata.sessionId).toBe(older.recording.getSessionId());
    } finally {
      await lock.release();
    }
  });
});
