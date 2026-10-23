/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { describe, expect, it } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { testJournalSeams } from '../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { createChildSessionJournal } from './childJournal.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { SessionLockManager } from './SessionLockManager.js';
import { createLockedSessionRecorder } from './sessionRecorderFactory.js';

import { userRow } from './__tests__/support/recordedJournals.js';

describe.each(['old', 'journal'] as const)('child history on %s', (backend) => {
  const directory = useTempDir('child-backend-');

  function options(): Parameters<typeof createChildSessionJournal>[0] {
    return {
      sessionId: 'child-session',
      parentSessionId: 'parent-session',
      projectHash: 'child-project',
      chatsDir: directory(),
      workspaceDirs: ['/w'],
      provider: 'anthropic',
      model: 'model',
    };
  }

  it('lazily attaches the child mirror, persists only child rows and removes its artifacts', async () => {
    const parent = await createLockedSessionRecorder({
      ...options(),
      sessionId: 'parent-session',
      workspaceDirs: [...options().workspaceDirs],
    });
    const parentHistory = new HistoryService({ recording: parent });
    const child = await createChildSessionJournal(options());
    let history: HistoryService | undefined;
    try {
      parentHistory.add(userRow('parent work'));
      await parentHistory.waitForCommit();
      const parentFile = parent.getFilePath();
      if (parentFile === null) throw new Error('Missing parent file');
      const before = await readFile(parentFile);
      history = new HistoryService({ recording: child.recording });
      history.add(userRow('child work'));
      await history.waitForCommit();
      const childFile = child.recording.getFilePath();
      expect(
        childFile?.endsWith(backend === 'journal' ? '.llxj' : '.jsonl'),
      ).toBe(true);
      expect(childFile).not.toBe(parentFile);
      await collectJournalRowsForAssertions(history, (rows) => {
        expect(rows.map((row) => row.blocks)).toStrictEqual([
          userRow('child work').blocks,
        ]);
      });
      expect(await readFile(parentFile)).toStrictEqual(before);
      expect(
        await SessionLockManager.isLocked(directory(), child.sessionId),
      ).toBe(true);
      await history.dispose();
      await child.dispose();
      await expect(child.dispose()).resolves.toBeUndefined();
      expect(
        await SessionLockManager.isLocked(directory(), child.sessionId),
      ).toBe(false);
      expect(await readdir(directory())).toStrictEqual(
        expect.arrayContaining([basename(parentFile)]),
      );
      expect(
        (await readdir(directory())).filter((file) =>
          file.startsWith('session-'),
        ),
      ).toHaveLength(1);
    } finally {
      await history?.dispose();
      await child.dispose();
      await parentHistory.dispose();
      await parent.dispose();
    }
  });

  it('late attaches pre-existing child rows without a parent seed', async () => {
    const child = await createChildSessionJournal(options());
    const history = new HistoryService();
    try {
      history.add(userRow('seed'));
      history.add(userRow('pre-attach child row'));
      await history.waitForCommit();
      const attachment = history.attachJournal(child.recording);
      history.add(userRow('post-attach child row'));
      await attachment;
      await history.waitForCommit();
      await collectJournalRowsForAssertions(history, (rows) => {
        expect(rows.map((row) => row.blocks)).toStrictEqual([
          userRow('seed').blocks,
          userRow('pre-attach child row').blocks,
          userRow('post-attach child row').blocks,
        ]);
      });
    } finally {
      await history.dispose();
      await child.dispose();
    }
    expect(await readdir(directory())).toStrictEqual([]);
  });

  it('removes the partial file and lock when initialization fails', async () => {
    const seams = testJournalSeams({ failWriteAt: 0 });
    await expect(
      createChildSessionJournal({
        ...options(),
        io: {
          appendFile: async () => {
            throw new Error('injected init failure');
          },
        },
        journal: { journal: seams.dependencies },
      }),
    ).rejects.toThrow(/injected|write/i);
    expect(await readdir(directory())).toStrictEqual([]);
    expect(
      await SessionLockManager.isLocked(directory(), 'child-session'),
    ).toBe(false);
  });
});

describe('journal child metadata at creation', () => {
  const directory = useTempDir('child-metadata-');

  it('writes its allocated identity and parent before runtime initialization', async () => {
    const child = await createChildSessionJournal({
      sessionId: 'allocated-child',
      parentSessionId: 'parent-session',
      projectHash: 'project',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'model',
    });
    try {
      const file = child.recording.getFilePath();
      if (file === null) throw new Error('Missing child file');
      const facts = await readJournalFileFacts(file);
      expect(facts?.facts.start).toMatchObject({
        kind: 'subagent',
        parentSessionId: 'parent-session',
      });
      expect(facts?.facts.sessionId).toBe(child.sessionId);
    } finally {
      await child.dispose();
    }
  });
});
