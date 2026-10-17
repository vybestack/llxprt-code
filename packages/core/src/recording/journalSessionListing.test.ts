/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { listJournalSessions } from './journalSessionListing.js';
import {
  PROJECT,
  chatsDirIn,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

describe('journal session listing', () => {
  const directory = useTempDir('journal-listing-');

  it('lists the sessions of the project newest first, from their facts', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-old', {
      rows: [userRow('one')],
      modifiedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await recordJournal(chats, 'session-new', {
      rows: [userRow('two')],
      title: 'Newest',
      provider: 'openai',
      modifiedAt: new Date('2026-02-01T00:00:00Z'),
    });
    await recordJournal(chats, 'session-other', {
      projectHash: 'another-project',
      modifiedAt: new Date('2026-03-01T00:00:00Z'),
    });
    await recordJournal(chats, 'session-child', {
      kind: 'subagent',
      modifiedAt: new Date('2026-04-01T00:00:00Z'),
    });

    const { sessions, unreadableRecordings } = await listJournalSessions(
      chats,
      PROJECT,
    );

    expect(sessions.map((s) => s.sessionId)).toStrictEqual([
      'session-new',
      'session-old',
    ]);
    expect(sessions[0]).toMatchObject({
      projectHash: PROJECT,
      provider: 'openai',
      model: 'model-1',
      title: 'Newest',
      kind: 'main',
    });
    expect(sessions[1].title).toBeUndefined();
    expect(unreadableRecordings).toStrictEqual([]);
  });

  it('lists a retired JSONL file as unreadable with the single message, without opening it', async () => {
    const chats = chatsDirIn(directory());
    await fsp.mkdir(chats, { recursive: true });
    const retired = path.join(
      chats,
      'session-2026-01-01T00-00-00-a-aaaaaaaa.jsonl',
    );
    await fsp.writeFile(retired, '{"v":2,"seq":1,"type":"session_start"}\n');
    await recordJournal(chats, 'session-ok', { rows: [userRow('x')] });

    const { sessions, unreadableRecordings } = await listJournalSessions(
      chats,
      PROJECT,
    );

    expect(sessions.map((s) => s.sessionId)).toStrictEqual(['session-ok']);
    expect(unreadableRecordings).toStrictEqual([
      { filePath: retired, reason: retiredJournalMessage(retired) },
    ]);
  });

  it('lists damaged and empty journal files as unreadable and keeps the healthy ones', async () => {
    const chats = chatsDirIn(directory());
    await fsp.mkdir(chats, { recursive: true });
    const garbage = path.join(chats, 'session-garbage.llxj');
    const empty = path.join(chats, 'session-empty.llxj');
    await fsp.writeFile(garbage, new Uint8Array(200).fill(0x41));
    await fsp.writeFile(empty, new Uint8Array(0));
    await recordJournal(chats, 'session-ok', { rows: [userRow('x')] });

    const { sessions, unreadableRecordings } = await listJournalSessions(
      chats,
      PROJECT,
    );

    expect(sessions.map((s) => s.sessionId)).toStrictEqual(['session-ok']);
    expect(unreadableRecordings).toStrictEqual([
      { filePath: empty, reason: retiredJournalMessage(empty) },
      { filePath: garbage, reason: retiredJournalMessage(garbage) },
    ]);
  });

  it('holds no sessions for a directory that does not exist', async () => {
    const listing = await listJournalSessions(
      path.join(directory(), 'missing'),
      PROJECT,
    );

    expect(listing).toStrictEqual({ sessions: [], unreadableRecordings: [] });
  });
});
