/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { testJournalSeams } from '../journal/__tests__/support/journalFixtures.js';
import { JournalSession } from '../services/history/journalSession.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { sessionFactEdit } from './sessionEdits.js';
import {
  SESSION_KEYS,
  decodeDirectoriesFact,
  encodeSessionFact,
} from './sessionMetaKeys.js';

describe('session metadata VALUE bodies', () => {
  const directory = useTempDir('metadata-body-');

  for (const count of [1, 513, 8193]) {
    it(`persists and resumes ${count} admitted workspace directories`, async () => {
      const root = directory();
      const workspace = new WorkspaceContext(root);
      for (let index = 1; index < count; index++) {
        const child = join(root, `${index}-${'d'.repeat(64)}`);
        await mkdir(child);
        workspace.addDirectory(child);
      }
      const directories = [...workspace.getDirectories()];
      expect(directories).toHaveLength(count);
      const config = {
        sessionId: 'metadata-body',
        projectHash: 'project',
        chatsDir: join(root, 'chats'),
        workspaceDirs: directories,
        provider: 'test',
        model: 'test',
        journal: { journal: testJournalSeams().dependencies },
      };
      const recording = JournalRecordingService.create(config);
      const session = await recording.session();
      const file = session.path;
      recording.recordDirectoriesChanged([...directories].reverse());
      await recording.flush();
      expect(await session.store.compact()).toBe('swapped');
      await recording.dispose();
      const resumed = await JournalRecordingService.open(config, file);
      try {
        const stored = await (
          await resumed.session()
        ).store.getState(SESSION_KEYS.directories);
        if (stored === undefined) throw new Error('Missing directories');
        expect(decodeDirectoriesFact(stored)).toStrictEqual(
          [...directories].reverse(),
        );
        const listing = await readJournalFileFacts(file);
        expect(listing?.facts.start.workspaceDirs).toStrictEqual(directories);
        expect(listing?.facts.directories).toStrictEqual(
          [...directories].reverse(),
        );
        resumed.recordDirectoriesChanged([directories[0]]);
        await resumed.flush();
        expect(
          (await readJournalFileFacts(file))?.facts.directories,
        ).toStrictEqual([directories[0]]);
      } finally {
        await resumed.dispose();
      }
    });
  }

  it('publishes a large session fact alongside a prepared group', async () => {
    const file = join(directory(), 'prepared.llxj');
    const session = await JournalSession.create(file, {
      journal: testJournalSeams().dependencies,
    });
    const title = 'session title '.repeat(16 * 1024);
    try {
      await session.store.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: (group) => group.build([{ kind: 'append', rows: [] }]),
        },
        sessionFactEdit(SESSION_KEYS.title, title),
      ]);
      expect(await session.store.getState(SESSION_KEYS.title)).toStrictEqual(
        encodeSessionFact(title),
      );
    } finally {
      await session.close();
    }
  });

  it('resumes small metadata written through the original map-value path', async () => {
    const root = directory();
    const file = join(root, 'previous.llxj');
    const journal = { journal: testJournalSeams().dependencies };
    const session = await JournalSession.create(file, journal);
    const values: ReadonlyArray<readonly [string, unknown]> = [
      [SESSION_KEYS.id, 'previous'],
      [
        SESSION_KEYS.start,
        {
          startTime: new Date().toISOString(),
          projectHash: 'project',
          workspaceDirs: [root],
          kind: 'main',
        },
      ],
      [SESSION_KEYS.provider, { provider: 'test', model: 'test' }],
      [SESSION_KEYS.directories, [root]],
    ];
    await session.store.commit(
      values.map(([key, value]) => ({
        kind: 'setState',
        key,
        value: encodeSessionFact(value),
      })),
    );
    await session.close();
    const resumed = await JournalRecordingService.open(
      {
        sessionId: 'previous',
        projectHash: 'project',
        chatsDir: root,
        workspaceDirs: [],
        provider: 'unused',
        model: 'unused',
        journal,
      },
      file,
    );
    try {
      expect(
        (await readJournalFileFacts(file))?.facts.directories,
      ).toStrictEqual([root]);
      const stored = await (
        await resumed.session()
      ).store.getState(SESSION_KEYS.directories);
      if (stored === undefined)
        throw new Error('Missing original map metadata');
      expect(decodeDirectoriesFact(stored)).toStrictEqual([root]);
    } finally {
      await resumed.dispose();
    }
  });
});
