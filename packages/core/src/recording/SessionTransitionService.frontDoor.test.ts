/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalResumeBoot } from './journalResume.js';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionTransitionService } from './SessionTransitionService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import type { ContinueTarget } from './types.js';
import type { IContent } from '../services/history/IContent.js';

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

describe('SessionTransitionService.forkFromCheckpoint dispatches by backend', () => {
  const directory = useTempDir('transition-front-door-');
  const setBackend = useBackendEnv();

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
    setBackend('journal');
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
    setBackend('journal');
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

  it('on the old backend returns the JSONL recorder and a cursor boot', async () => {
    setBackend('old');
    const chats = chatsDirIn(directory());
    const parent = new SessionRecordingService({
      sessionId: 'old-src',
      projectHash: PROJECT,
      chatsDir: chats,
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'm',
    });
    parent.recordContent(userRow('one'));
    parent.recordContent(userRow('two'));
    const checkpoint = await parent.createCheckpoint('cp');
    parent.recordContent(userRow('three'));
    await parent.flush();
    await parent.dispose();
    const filePath = parent.getFilePath();
    if (filePath === null) throw new Error('no file');

    const result = await new SessionTransitionService().forkFromCheckpoint(
      {
        kind: 'checkpoint',
        source: {
          sessionId: 'old-src',
          filePath,
          projectHash: PROJECT,
          startTime: new Date().toISOString(),
          lastModified: new Date(),
          fileSize: 0,
          provider: 'anthropic',
          model: 'm',
        },
        checkpointId: checkpoint.checkpointId,
        checkpointName: 'cp',
        sequence: checkpoint.sequence,
      },
      chats,
      PROJECT,
      'openai',
      'gpt-x',
      ['/w'],
    );

    if (!result.ok) throw new Error(result.error);
    try {
      expect(result.recording).toBeInstanceOf(SessionRecordingService);
      expect(result.boot).toBeInstanceOf(ResumeCursorBoot);
      const rows = await Array.fromAsync(result.boot.streamRows());
      expect(rows.map(textOf)).toStrictEqual(['one', 'two']);
    } finally {
      await result.boot.close();
      await result.recording.dispose();
      await result.lockHandle.release();
    }
  });
});
