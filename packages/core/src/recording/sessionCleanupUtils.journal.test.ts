/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { getAllJsonlSessionFiles } from './sessionCleanupUtils.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

describe('session cleanup listing follows the backend extension', () => {
  const root = useTempDir('cleanup-journal-');
  const setBackend = useBackendEnv();

  it('lists journal files with their session id and leaves retired JSONL files alone', async () => {
    setBackend('journal');
    const chats = path.join(root(), 'chats');
    const { filePath } = await recordJournal(chats, 'sess-1', {
      rows: [userRow('hi')],
    });
    await fsp.writeFile(path.join(chats, 'session-retired.jsonl'), '{}\n');

    const entries = await getAllJsonlSessionFiles(chats, 'sess-1');

    expect(entries.map((e) => e.filePath)).toStrictEqual([filePath]);
    expect(entries[0].sessionInfo).toMatchObject({
      id: 'sess-1',
      isCurrentSession: true,
    });
  });

  it('lists a damaged journal as unreadable', async () => {
    setBackend('journal');
    const chats = path.join(root(), 'chats');
    await fsp.mkdir(chats, { recursive: true });
    await fsp.writeFile(path.join(chats, 'session-bad.llxj'), 'garbage');

    const entries = await getAllJsonlSessionFiles(chats);

    expect(entries).toHaveLength(1);
    expect(entries[0].sessionInfo).toBeNull();
  });

  it('lists only JSONL files on the old backend', async () => {
    setBackend('old');
    const chats = path.join(root(), 'chats');
    await recordJournal(chats, 'sess-1', { rows: [userRow('hi')] });
    expect(await getAllJsonlSessionFiles(chats)).toStrictEqual([]);
  });
});
