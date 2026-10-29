/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../services/history/journalSession.js';
import { forkJournalFromCheckpoint } from './journalFork.js';
import { JournalResumeBoot } from './journalResume.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SESSION_KEYS, decodeSessionFact } from './sessionMetaKeys.js';

import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import type { ContinueTarget } from './types.js';

type CheckpointTarget = Extract<ContinueTarget, { kind: 'checkpoint' }>;

async function texts(session: JournalSession): Promise<string[]> {
  const found: string[] = [];
  for await (const row of session.rows()) {
    const block = row.content.blocks[0];
    found.push(block.type === 'text' ? block.text : '');
  }
  return found;
}

describe('fork from a checkpoint on the journal (design 4.9)', () => {
  const directory = useTempDir('journal-fork-');

  async function checkpointTarget(
    chats: string,
    name: string,
  ): Promise<CheckpointTarget> {
    const found = await SessionDiscovery.listContinueTargetsDetailedBounded(
      chats,
      PROJECT,
    );
    const target = found.targets.find(
      (candidate): candidate is CheckpointTarget =>
        candidate.kind === 'checkpoint' && candidate.checkpointName === name,
    );
    if (target === undefined) throw new Error(`no checkpoint target ${name}`);
    return target;
  }

  function request(chats: string, target: CheckpointTarget) {
    return {
      target,
      chatsDir: chats,
      projectHash: PROJECT,
      currentProvider: 'openai',
      currentModel: 'gpt-x',
      workspaceDirs: ['/work/child'],
      journal: journalSeams(),
    };
  }

  it('clones the saved version into a child file and leaves the source file as it was', async () => {
    const chats = chatsDirIn(directory());
    const source = await recordJournal(chats, 'src', {
      rows: [userRow('one'), userRow('two')],
      checkpoints: ['cp'],
      rowsAfterCheckpoints: [userRow('three')],
      name: 'parent name',
      preview: 'one',
    });
    const before = await fsp.readFile(source.filePath);
    const target = await checkpointTarget(chats, 'cp');

    const result = await forkJournalFromCheckpoint(request(chats, target));

    if (!result.ok) throw new Error(result.error);
    try {
      expect(result.metadata.sessionId).not.toBe('src');
      expect(result.recording.ownsLockFor(result.metadata.sessionId)).toBe(
        true,
      );
      const child = await result.recording.session();
      expect(await texts(child)).toStrictEqual(['one', 'two']);
      const fact = async (key: string): Promise<unknown> => {
        const bytes = await child.store.getState(key);
        return bytes === undefined ? undefined : decodeSessionFact(bytes);
      };
      expect(await fact(SESSION_KEYS.id)).toBe(result.metadata.sessionId);
      expect(await fact(SESSION_KEYS.fork)).toStrictEqual({
        parentSessionId: 'src',
        parentSequence: source.checkpoints[0].sequence,
        checkpointId: source.checkpoints[0].checkpointId,
        checkpointName: 'cp',
      });
      expect(await fact(SESSION_KEYS.name)).toBeNull();
      expect(await fact(SESSION_KEYS.provider)).toStrictEqual({
        provider: 'openai',
        model: 'gpt-x',
      });
      expect(await fact(SESSION_KEYS.directories)).toStrictEqual([
        '/work/child',
      ]);
      expect(await fact(SESSION_KEYS.preview)).toBe('one');
      expect(await fsp.readFile(source.filePath)).toStrictEqual(before);
      await result.recording.dispose();
      expect(
        await SessionLockManager.acquire(chats, 'src').then(async (lock) => {
          await lock.release();
          return true;
        }),
      ).toBe(true);
    } finally {
      await result.recording.dispose().catch(() => undefined);
    }
  });

  it('hands the child over as a resume point and a boot that streams the cloned rows', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'src', {
      rows: [userRow('one'), userRow('two')],
      checkpoints: ['cp'],
      rowsAfterCheckpoints: [userRow('three')],
    });
    const target = await checkpointTarget(chats, 'cp');

    const result = await forkJournalFromCheckpoint(request(chats, target));

    if (!result.ok) throw new Error(result.error);
    try {
      const published = (await result.recording.session()).store.published;
      if (published === undefined) throw new Error('the child has no version');
      expect(result.resumePoint).toStrictEqual({
        commitSeq: published.commitSeq,
        rows: 2,
        nextLabel: published.nextLabel,
      });
      expect(result.boot).toBeInstanceOf(JournalResumeBoot);
      const streamed: string[] = [];
      for await (const row of result.boot.streamRows()) {
        const block = row.blocks[0];
        streamed.push(block.type === 'text' ? block.text : '');
      }
      expect(streamed).toStrictEqual(['one', 'two']);
    } finally {
      await result.recording.dispose().catch(() => undefined);
    }
  });

  it('refuses a deleted checkpoint and leaves no child file or lock', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'src', {
      rows: [userRow('one')],
      checkpoints: ['gone', 'kept'],
      deleteCheckpoints: ['gone'],
    });
    const live = await checkpointTarget(chats, 'kept');
    const stale: CheckpointTarget = {
      ...live,
      checkpointId: 'no-such-id',
      checkpointName: 'gone',
    };
    const files = await fsp.readdir(chats);

    const result = await forkJournalFromCheckpoint(request(chats, stale));

    expect(result).toStrictEqual({
      ok: false,
      error: "Checkpoint 'gone' (no-such-id) is not live",
    });
    expect(await fsp.readdir(chats)).toStrictEqual(files);
  });

  it('reports a source session that another holder has locked', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'src', {
      rows: [userRow('one')],
      checkpoints: ['cp'],
    });
    const target = await checkpointTarget(chats, 'cp');
    const held = await SessionLockManager.acquire(chats, 'src');
    try {
      const result = await forkJournalFromCheckpoint(request(chats, target));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('Source session is in use');
    } finally {
      await held.release();
    }
  });
});
