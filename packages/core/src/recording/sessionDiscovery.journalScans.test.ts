/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  PROJECT,
  chatsDirIn,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

describe('the bounded discovery scans on the journal backend', () => {
  const directory = useTempDir('session-discovery-scans-');
  const setBackend = useBackendEnv();

  it('reads the session header of a journal file from its facts', async () => {
    setBackend('journal');
    const { filePath } = await recordJournal(
      chatsDirIn(directory()),
      'sess-h',
      { rows: [userRow('hello')], provider: 'openai' },
    );

    const header = await SessionDiscovery.readSessionHeader(filePath);

    expect(header).toMatchObject({
      sessionId: 'sess-h',
      projectHash: PROJECT,
      provider: 'openai',
      model: 'model-1',
      workspaceDirs: ['/work/a'],
      kind: 'main',
    });
    expect(typeof header?.startTime).toBe('string');
  });

  it('gives no header for a damaged journal and never opens a retired JSONL file', async () => {
    setBackend('journal');
    const chats = chatsDirIn(directory());
    await fsp.mkdir(chats, { recursive: true });
    const damaged = path.join(chats, 'session-damaged.llxj');
    await fsp.writeFile(damaged, 'not a journal');
    const retired = path.join(chats, 'session-retired.jsonl');
    await fsp.writeFile(
      retired,
      JSON.stringify({
        v: 2,
        seq: 1,
        ts: 'x',
        type: 'session_start',
        payload: {
          sessionId: 'retired',
          projectHash: PROJECT,
          workspaceDirs: [],
          provider: 'p',
          model: 'm',
          startTime: 'x',
        },
      }) + '\n',
    );

    expect(await SessionDiscovery.readSessionHeader(damaged)).toBeNull();
    expect(await SessionDiscovery.readSessionHeader(retired)).toBeNull();
  });

  it('builds continue targets from the journal facts without scanning rows, and reports a retired file', async () => {
    setBackend('journal');
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'sess-n', {
      rows: [userRow('named one')],
      name: 'my name',
    });
    await recordJournal(chats, 'sess-p', { rows: [userRow('plain one')] });
    const retired = path.join(chats, 'session-retired.jsonl');
    await fsp.writeFile(retired, '{}\n');

    const found = await SessionDiscovery.listContinueTargetsDetailedBounded(
      chats,
      PROJECT,
    );

    const sessions = found.targets.flatMap((t) =>
      t.kind === 'session' ? [t.session] : [],
    );
    expect(sessions.map((s) => s.sessionId).sort()).toStrictEqual([
      'sess-n',
      'sess-p',
    ]);
    expect(sessions.find((s) => s.sessionId === 'sess-n')?.name).toBe(
      'my name',
    );
    expect(found.unreadableRecordings.map((r) => r.filePath)).toStrictEqual([
      retired,
    ]);
    expect(found.recordingErrors).toStrictEqual([
      `${retired}: ${retiredJournalMessage(retired)}`,
    ]);
    expect(found.skippedCount).toBe(1);
  });
});
