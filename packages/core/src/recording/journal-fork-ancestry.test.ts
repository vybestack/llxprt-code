/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import {
  PROJECT,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import { JournalCheckpointService } from './journalCheckpointService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionTransitionService } from './SessionTransitionService.js';
import { SESSION_KEYS, decodeSessionFact } from './sessionMetaKeys.js';

describe('journal fork ancestry', () => {
  const directory = useTempDir('journal-fork-ancestry-');

  it('records the checkpoint metadata read under the source lock instead of stale picker metadata', async () => {
    const source = await recordJournal(directory(), 'source', {
      rows: [userRow('retained')],
      checkpoints: ['original'],
      rowsAfterCheckpoints: [userRow('not in child')],
    });
    const targets = await SessionDiscovery.listContinueTargets(
      directory(),
      PROJECT,
    );
    const target = targets.find((candidate) => candidate.kind === 'checkpoint');
    if (target?.kind !== 'checkpoint')
      throw new Error('Missing checkpoint target');
    await new JournalCheckpointService(journalSeams()).renameCheckpointClosed(
      source.filePath,
      PROJECT,
      directory(),
      source.sessionId,
      target.checkpointId,
      'renamed',
    );
    const result = await new SessionTransitionService({
      journal: journalSeams(),
    }).forkFromCheckpoint(
      { ...target, sequence: target.sequence + 100 },
      directory(),
      PROJECT,
      'anthropic',
      'model-1',
      ['/work/a'],
    );
    if (!result.ok) throw new Error(result.error);
    try {
      if (!(result.recording instanceof JournalRecordingService))
        throw new Error('Expected journal recorder');
      const session = await result.recording.session();
      const bytes = await session.store.getState(SESSION_KEYS.fork);
      if (bytes === undefined) throw new Error('Missing fork ancestry');
      expect(decodeSessionFact(bytes)).toStrictEqual({
        parentSessionId: source.sessionId,
        parentSequence: source.checkpoints[0].sequence,
        checkpointId: target.checkpointId,
        checkpointName: 'renamed',
      });
      expect(
        (await Array.fromAsync(result.boot.streamRows())).map(
          (row) => row.blocks,
        ),
      ).toStrictEqual([userRow('retained').blocks]);
    } finally {
      await result.recording.dispose();
    }
  });
});
