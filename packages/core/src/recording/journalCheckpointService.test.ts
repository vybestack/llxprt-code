/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Behaviour of the checkpoint lifecycle on the journal backend. The cases of
 * `checkpointLifecycle.integration.test.ts` that carry over keep their
 * assertions; the ones that read JSONL lines or replay events are stated in
 * terms of the journal (a deleted checkpoint is absent from the live list,
 * the file only grows by one group).
 */
import * as fsp from 'node:fs/promises';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../services/history/journalSession.js';
import { CheckpointLockError } from './checkpointNaming.js';
import { JournalCheckpointService } from './journalCheckpointService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { SessionLockManager } from './SessionLockManager.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

describe('checkpoint lifecycle on the journal backend', () => {
  const directory = useTempDir('journal-checkpoints-');
  const setBackend = useBackendEnv();
  const live: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const recording of live.splice(0)) {
      await recording.dispose().catch(() => undefined);
    }
  });

  function chats(): string {
    setBackend('journal');
    return chatsDirIn(directory());
  }

  function service(): JournalCheckpointService {
    return new JournalCheckpointService(journalSeams());
  }

  async function active(
    chatsDir: string,
    sessionId: string,
    texts: string[],
  ): Promise<JournalRecordingService> {
    const recording = await JournalRecordingService.createLocked({
      sessionId,
      projectHash: PROJECT,
      chatsDir,
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: journalSeams(),
    });
    live.push(recording);
    const session = await recording.session();
    await session.append(texts.map(userRow));
    await recording.flush();
    return recording;
  }

  async function names(file: string): Promise<string[]> {
    return (await service().listCheckpoints(file)).map((c) => c.name);
  }

  describe('lifecycle by stable id (A6)', () => {
    it('rename preserves ID and sequence', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A'), userRow('B')],
        checkpoints: ['original'],
      });
      const [cp] = source.checkpoints;

      await service().renameCheckpointClosed(
        source.filePath,
        PROJECT,
        chatsDir,
        'src',
        cp.checkpointId,
        'renamed',
      );

      const checkpoints = await service().listCheckpoints(source.filePath);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].checkpointId).toBe(cp.checkpointId);
      expect(checkpoints[0].name).toBe('renamed');
      expect(checkpoints[0].sequence).toBe(cp.sequence);
    });

    it('delete removes only the reference, not other checkpoints', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A')],
        checkpoints: ['foo', 'bar'],
      });

      await service().deleteCheckpointClosed(
        source.filePath,
        PROJECT,
        chatsDir,
        'src',
        source.checkpoints[0].checkpointId,
      );

      expect(await names(source.filePath)).toStrictEqual(['bar']);
    });

    it('lists the live checkpoints as deletion blockers', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A')],
        checkpoints: ['gone', 'kept'],
        deleteCheckpoints: ['gone'],
      });

      const blockers = await service().getDeletionBlockers(source.filePath);

      expect(blockers.map((blocker) => blocker.name)).toStrictEqual(['kept']);
      expect(blockers[0].deleted).toBe(false);
    });
  });

  describe('project-wide lifecycle coordination', () => {
    it('rejects a second concurrent creator of the same project-wide name', async () => {
      const chatsDir = chats();
      const first = await active(chatsDir, 'first', ['first']);
      const second = await active(chatsDir, 'second', ['second']);

      const results = await Promise.allSettled([
        service().createCheckpoint(first, PROJECT, 'shared-name'),
        service().createCheckpoint(second, PROJECT, 'shared-name'),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    });

    it('rejects a duplicate name when creating a checkpoint on a closed session', async () => {
      const chatsDir = chats();
      await recordJournal(chatsDir, 'first', {
        rows: [userRow('first')],
        checkpoints: ['shared-name'],
      });
      const second = await recordJournal(chatsDir, 'second', {
        rows: [userRow('second')],
      });

      await expect(
        service().createCheckpointClosed(
          second.filePath,
          PROJECT,
          chatsDir,
          'second',
          'shared-name',
        ),
      ).rejects.toThrow(/already exists/);
      expect(await service().listCheckpoints(second.filePath)).toHaveLength(0);
    });

    it('creates a checkpoint on a closed session and refuses an empty one', async () => {
      const chatsDir = chats();
      const full = await recordJournal(chatsDir, 'full', {
        rows: [userRow('one'), userRow('two')],
      });
      const empty = await recordJournal(chatsDir, 'empty', { name: 'named' });

      const info = await service().createCheckpointClosed(
        full.filePath,
        PROJECT,
        chatsDir,
        'full',
        '  fresh  ',
      );

      expect(info.name).toBe('fresh');
      const [listed] = await service().listCheckpoints(full.filePath);
      expect(listed.checkpointId).toBe(info.checkpointId);
      expect(listed.sequence).toBe(info.sequence);
      await expect(
        service().createCheckpointClosed(
          empty.filePath,
          PROJECT,
          chatsDir,
          'empty',
          'nothing',
        ),
      ).rejects.toThrow('conversation has no content yet');
    });

    it('refuses a name that is a session id or a checkpoint id', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A')],
        checkpoints: ['foo'],
      });

      for (const taken of ['src', source.checkpoints[0].checkpointId]) {
        await expect(
          service().renameCheckpointClosed(
            source.filePath,
            PROJECT,
            chatsDir,
            'src',
            source.checkpoints[0].checkpointId,
            taken,
            true,
          ),
        ).rejects.toThrow(/already exists/);
      }
      expect(await names(source.filePath)).toStrictEqual(['foo']);
    });

    it('overwrites a colliding closed-session checkpoint after confirmation', async () => {
      const chatsDir = chats();
      const replaced = await recordJournal(chatsDir, 'replaced', {
        rows: [userRow('replaced')],
        checkpoints: ['shared-name'],
      });
      const source = await recordJournal(chatsDir, 'source', {
        rows: [userRow('source')],
        checkpoints: ['source-name'],
      });
      const [sourceCheckpoint] = source.checkpoints;

      await expect(
        service().renameCheckpointClosed(
          source.filePath,
          PROJECT,
          chatsDir,
          'source',
          sourceCheckpoint.checkpointId,
          'shared-name',
        ),
      ).rejects.toThrow(/already exists/);
      await service().renameCheckpointClosed(
        source.filePath,
        PROJECT,
        chatsDir,
        'source',
        sourceCheckpoint.checkpointId,
        'shared-name',
        true,
      );

      expect(await names(replaced.filePath)).toStrictEqual([]);
      const kept = await service().listCheckpoints(source.filePath);
      expect(kept).toContainEqual(
        expect.objectContaining({
          checkpointId: sourceCheckpoint.checkpointId,
          name: 'shared-name',
          deleted: false,
        }),
      );
    });

    it('overwrites a colliding checkpoint in the active recording', async () => {
      const chatsDir = chats();
      const recording = await active(chatsDir, 'active', ['source']);
      const replaced = await recording.createCheckpoint('shared-name');
      await (await recording.session()).append([userRow('tail')]);

      const created = await service().createCheckpoint(
        recording,
        PROJECT,
        'shared-name',
        true,
      );

      const file = recording.getFilePath();
      if (file === null) throw new Error('no file');
      const listed = await service().listCheckpoints(file);
      expect(listed.map((c) => c.checkpointId)).not.toContain(
        replaced.checkpointId,
      );
      expect(listed).toContainEqual(
        expect.objectContaining({
          checkpointId: created.checkpointId,
          name: 'shared-name',
          deleted: false,
        }),
      );
    });

    it('restores an overwritten checkpoint when the replacement action fails', async () => {
      const chatsDir = chats();
      const recording = await active(chatsDir, 'active', ['source']);
      const existing = await recording.createCheckpoint('shared-name');
      const createSpy = spyOn(recording, 'createCheckpoint').mockRejectedValue(
        new Error('replacement failed'),
      );

      try {
        await expect(
          service().createCheckpoint(recording, PROJECT, 'shared-name', true),
        ).rejects.toThrow('replacement failed');
      } finally {
        createSpy.mockRestore();
      }

      const file = recording.getFilePath();
      if (file === null) throw new Error('no file');
      expect(await service().listCheckpoints(file)).toContainEqual(
        expect.objectContaining({
          checkpointId: existing.checkpointId,
          name: 'shared-name',
          deleted: false,
        }),
      );
    });

    it('takes the replacement back when removing the old holder of the name fails', async () => {
      const chatsDir = chats();
      const recording = await active(chatsDir, 'active', ['source']);
      const existing = await recording.createCheckpoint('shared-name');
      const deleteSpy = spyOn(
        recording,
        'deleteCheckpoint',
      ).mockRejectedValueOnce(new Error('delete failed'));

      try {
        await expect(
          service().createCheckpoint(recording, PROJECT, 'shared-name', true),
        ).rejects.toThrow('delete failed');
      } finally {
        deleteSpy.mockRestore();
      }

      const file = recording.getFilePath();
      if (file === null) throw new Error('no file');
      const listed = await service().listCheckpoints(file);
      expect(listed.map((c) => c.checkpointId)).toStrictEqual([
        existing.checkpointId,
      ]);
    });

    it('moves a session name, clearing it from the session that held it', async () => {
      const chatsDir = chats();
      const holder = await recordJournal(chatsDir, 'holder', {
        rows: [userRow('holder')],
        name: 'shared-name',
      });
      const recording = await active(chatsDir, 'active', ['mine']);

      await expect(
        service().setSessionName(recording, PROJECT, 'shared-name'),
      ).rejects.toThrow(/already exists/);
      await service().setSessionName(recording, PROJECT, 'shared-name', true);

      const mine = await readJournalFileFacts(recording.getFilePath() ?? '');
      const theirs = await readJournalFileFacts(holder.filePath);
      expect(mine?.facts.name).toBe('shared-name');
      expect(theirs?.facts.name).toBeNull();
    });

    it('refuses to rename or delete a checkpoint that is not live', async () => {
      const chatsDir = chats();
      const recording = await active(chatsDir, 'active', ['source']);
      const info = await recording.createCheckpoint('foo');
      await recording.deleteCheckpoint(info.checkpointId);

      await expect(
        service().renameCheckpoint(
          recording,
          PROJECT,
          info.checkpointId,
          'bar',
        ),
      ).rejects.toThrow(/not found or deleted/);
      await expect(
        service().deleteCheckpoint(recording, PROJECT, info.checkpointId),
      ).rejects.toThrow(/not found or deleted/);
    });
  });

  describe('checkpoints are not history (A15)', () => {
    it('checkpoint groups never add rows', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A')],
        checkpoints: ['foo'],
        rowsAfterCheckpoints: [userRow('B')],
      });

      const facts = await readJournalFileFacts(source.filePath);
      expect(facts?.rows).toBe(2);
      expect(await names(source.filePath)).toStrictEqual(['foo']);
    });
  });

  describe('closed-source writes are lock-checked and append one group (A17)', () => {
    it('held lock causes error and no write', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A')],
        checkpoints: ['foo'],
      });
      const before = await fsp.readFile(source.filePath);
      const blockingLock = await SessionLockManager.acquire(chatsDir, 'src');

      try {
        const attempt = service().deleteCheckpointClosed(
          source.filePath,
          PROJECT,
          chatsDir,
          'src',
          source.checkpoints[0].checkpointId,
        );
        await expect(attempt).rejects.toThrow(/in use/);
        await expect(attempt).rejects.toBeInstanceOf(CheckpointLockError);
      } finally {
        await blockingLock.release();
      }

      expect(await fsp.readFile(source.filePath)).toStrictEqual(before);
    });

    it('exactly one group is appended and the prior bytes are unchanged', async () => {
      const chatsDir = chats();
      const source = await recordJournal(chatsDir, 'src', {
        rows: [userRow('A'), userRow('B')],
        checkpoints: ['foo'],
      });
      const before = await fsp.readFile(source.filePath);
      const commitSeq = async (): Promise<number | undefined> => {
        const session = await JournalSession.open(
          source.filePath,
          journalSeams(),
        );
        try {
          return session.store.published?.commitSeq;
        } finally {
          await session.close();
        }
      };
      const seqBefore = await commitSeq();

      await service().renameCheckpointClosed(
        source.filePath,
        PROJECT,
        chatsDir,
        'src',
        source.checkpoints[0].checkpointId,
        'renamed',
      );

      const after = await fsp.readFile(source.filePath);
      expect(after.length).toBeGreaterThan(before.length);
      expect(after.subarray(0, before.length)).toStrictEqual(before);
      expect(await commitSeq()).toBe((seqBefore ?? 0) + 1);
    });
  });

  describe('recorder disposal failure', () => {
    it('releases its lock and becomes inactive when the final flush fails', async () => {
      const chatsDir = chats();
      const recording = await active(chatsDir, 'dispose-flush-failure', ['a']);
      const flushSpy = spyOn(recording, 'flush').mockRejectedValueOnce(
        new Error('final flush failed'),
      );

      try {
        await expect(recording.dispose()).rejects.toThrow('final flush failed');
      } finally {
        flushSpy.mockRestore();
      }

      expect(recording.isActive()).toBe(false);
      expect(
        await SessionLockManager.isLocked(chatsDir, 'dispose-flush-failure'),
      ).toBe(false);
    });
  });
});
