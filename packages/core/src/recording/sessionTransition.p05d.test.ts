/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { SessionTransitionService } from './SessionTransitionService.js';
import type { SessionRecordingPort } from './recordingPort.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  LARGE_N,
  PAGE_BOUND,
  PROJECT_HASH,
  SMALL_N,
  seedRecording,
  recordingConfig,
  requireBoot,
  useJournalReadProbe,
} from './__tests__/support/journalRecordingFixture.js';

describe('bounded native checkpoint continuation', () => {
  const directory = useTempDir('fork-bounded-native-');
  const probe = useJournalReadProbe();
  const children: SessionRecordingPort[] = [];
  afterEach(async () => {
    for (const child of children.splice(0)) await child.dispose();
  });

  for (const count of [SMALL_N, LARGE_N]) {
    it(`forks the exact ${count / 2}-row checkpoint prefix without decoding history during the copy`, async () => {
      const source = await seedRecording(directory(), count, {
        checkpointAfter: count / 2,
      });
      if (source.target === undefined) throw new Error('Missing checkpoint');
      probe().reset();
      const result = await new SessionTransitionService().forkFromCheckpoint(
        source.target,
        directory(),
        PROJECT_HASH,
        'test',
        'model',
        ['/test/workspace'],
      );
      const boot = requireBoot(result);
      if (!result.ok) throw new Error(result.error);
      children.push(result.recording);
      expect('history' in result).toBe(false);
      expect(result.metadata.sessionId).not.toBe(
        source.recording.getSessionId(),
      );
      expect(probe().reads).toBeGreaterThan(0);
      expect(probe().decodedRows).toBe(0);
      expect(probe().peakReads).toBeLessThanOrEqual(PAGE_BOUND);
      expect(await Array.fromAsync(boot.streamRows())).toStrictEqual(
        source.contents.slice(0, count / 2),
      );
      const childFile = result.recording.getFilePath();
      if (childFile === null) throw new Error('Missing child');
      const child = await readJournalSnapshot(childFile, PROJECT_HASH);
      expect(child.history).toStrictEqual(source.contents.slice(0, count / 2));
      expect(child.ancestry).toMatchObject({
        parentSessionId: source.recording.getSessionId(),
        parentSequence: source.target.sequence,
      });
      expect(probe().activeReads).toBe(0);
    }, 60_000);
  }
  it('refuses a deleted checkpoint after a live metadata read', async () => {
    const source = await seedRecording(directory(), 4, { checkpointAfter: 2 });
    const target = source.target;
    if (target === undefined) throw new Error('Missing checkpoint');
    const recorder = await JournalRecordingService.open(
      recordingConfig(directory(), {
        sessionId: source.recording.getSessionId(),
      }),
      source.filePath,
    );
    try {
      await recorder.deleteCheckpoint(target.checkpointId);
    } finally {
      await recorder.dispose();
    }
    probe().reset();
    const result = await new SessionTransitionService().forkFromCheckpoint(
      target,
      directory(),
      PROJECT_HASH,
      'test',
      'model',
      [],
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('not live'),
    });
    expect(probe().reads).toBeGreaterThan(0);
    expect(probe().reads).toBeLessThanOrEqual(PAGE_BOUND);
    expect(probe().decodedRows).toBe(0);
  });
});
