/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalResumeBoot } from './journalResume.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SessionTransitionService } from './SessionTransitionService.js';

import type { IContent } from '../services/history/IContent.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import type { ContinueTarget } from './types.js';

type CheckpointTarget = Extract<ContinueTarget, { kind: 'checkpoint' }>;

function textOf(row: IContent): string {
  const block = row.blocks[0];
  return block.type === 'text' ? block.text : '';
}

async function lockIsFree(chats: string, sessionId: string): Promise<boolean> {
  const lock = await SessionLockManager.acquire(chats, sessionId);
  await lock.release();
  return true;
}

describe('SessionTransitionService.forkFromCheckpoint forks journal checkpoints', () => {
  const directory = useTempDir('transition-front-door-');

  async function journalTarget(chats: string): Promise<CheckpointTarget> {
    const found = await SessionDiscovery.listContinueTargetsDetailedBounded(
      chats,
      PROJECT,
    );
    const target = found.targets.find(
      (candidate): candidate is CheckpointTarget =>
        candidate.kind === 'checkpoint' && candidate.checkpointName === 'cp',
    );
    if (target === undefined) throw new Error('no checkpoint target');
    return target;
  }

  it('on the journal backend returns a journal recorder and a boot that streams the cloned rows', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'src', {
      rows: [userRow('one'), userRow('two')],
      checkpoints: ['cp'],
      rowsAfterCheckpoints: [userRow('three')],
    });
    const target = await journalTarget(chats);

    const result = await new SessionTransitionService({
      journal: journalSeams(),
    }).forkFromCheckpoint(target, chats, PROJECT, 'openai', 'gpt-x', ['/w']);

    if (!result.ok) throw new Error(result.error);
    try {
      expect(result.recording).toBeInstanceOf(JournalRecordingService);
      expect(result.boot).toBeInstanceOf(JournalResumeBoot);
      const rows = await Array.fromAsync(result.boot.streamRows());
      expect(rows.map(textOf)).toStrictEqual(['one', 'two']);
      expect(result.recording.ownsLockFor(result.metadata.sessionId)).toBe(
        true,
      );
      expect(await lockIsFree(chats, 'src')).toBe(true);
    } finally {
      await result.recording.dispose();
    }
  });

  it('on the journal backend leaves no child file and no lock when the checkpoint is not live', async () => {
    const chats = chatsDirIn(directory());
    const source = await recordJournal(chats, 'src', {
      rows: [userRow('one')],
      checkpoints: ['cp'],
      deleteCheckpoints: ['cp'],
    });
    const [checkpoint] = source.checkpoints;
    const target: CheckpointTarget = {
      kind: 'checkpoint',
      source: {
        sessionId: 'src',
        filePath: source.filePath,
        projectHash: PROJECT,
        startTime: new Date().toISOString(),
        lastModified: new Date(),
        fileSize: 0,
        provider: 'anthropic',
        model: 'model-1',
      },
      checkpointId: checkpoint.checkpointId,
      checkpointName: 'cp',
      sequence: checkpoint.sequence,
    };

    const result = await new SessionTransitionService({
      journal: journalSeams(),
    }).forkFromCheckpoint(target, chats, PROJECT, 'openai', 'gpt-x', ['/w']);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error).toContain('is not live');
    expect(await lockIsFree(chats, 'src')).toBe(true);
    expect(await fsp.readdir(chats)).toStrictEqual([
      path.basename(source.filePath),
    ]);
  });
});
