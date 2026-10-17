/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { HISTORY_BACKEND_ENV } from '../services/history/historyBackendSelect.js';
import { JournalHistoryStore } from '../services/history/journalHistoryStore.js';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SESSION_PREVIEW_LENGTH } from './sessionMetaKeys.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

describe('session discovery on the journal backend', () => {
  const directory = useTempDir('session-discovery-journal-');
  let saved: string | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => {
    saved = process.env[HISTORY_BACKEND_ENV];
    process.env[HISTORY_BACKEND_ENV] = 'journal';
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** A session written through the history store, the way a live agent writes it. */
  async function recordThroughStore(
    chats: string,
    sessionId: string,
    texts: readonly string[],
  ): Promise<string> {
    const recorder = JournalRecordingService.create({
      sessionId,
      projectHash: PROJECT,
      chatsDir: chats,
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: journalSeams(),
    });
    const primary = await JournalSession.create(
      path.join(directory(), `${sessionId}-primary.llxj`),
    );
    const store = new JournalHistoryStore(primary);
    cleanups.push(async () => {
      await store.dispose();
      await recorder.dispose().catch(() => undefined);
      await primary.close();
    });
    await store.attachJournal(recorder, true);
    for (const text of texts) {
      store.apply({ kind: 'content', content: userRow(text) });
    }
    await store.waitForDurable();
    await store.settleFanout();
    await recorder.flush();
    const file = recorder.getFilePath();
    if (file === null) throw new Error('The recorder wrote no file');
    return file;
  }

  it('lists journal sessions with the preview and the message count from the file, not from rows', async () => {
    const chats = chatsDirIn(directory());
    const file = await recordThroughStore(chats, 'session-a', [
      'first question',
      'second question',
      'third question',
    ]);

    const listed = await SessionDiscovery.listSessionsDetailed(chats, PROJECT);

    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0]).toMatchObject({
      sessionId: 'session-a',
      filePath: file,
      preview: 'first question',
      messageCount: 3,
    });
    expect(await SessionDiscovery.readFirstUserMessage(file)).toBe(
      'first question',
    );
    expect(await SessionDiscovery.hasContentEvents(file)).toBe(true);
  });

  it('cuts the preview to the preview length and to the length the caller asks for', async () => {
    const chats = chatsDirIn(directory());
    const long = 'x'.repeat(SESSION_PREVIEW_LENGTH + 50);
    const file = await recordThroughStore(chats, 'session-a', [long]);

    expect(await SessionDiscovery.readFirstUserMessage(file, 1000)).toBe(
      'x'.repeat(SESSION_PREVIEW_LENGTH),
    );
    expect(await SessionDiscovery.readFirstUserMessage(file, 10)).toBe(
      'x'.repeat(10),
    );
  });

  it('writes the preview once: a later user message does not replace it, and a reopened session keeps it', async () => {
    const chats = chatsDirIn(directory());
    const file = await recordThroughStore(chats, 'session-a', ['one', 'two']);

    expect(await SessionDiscovery.readFirstUserMessage(file)).toBe('one');
    const reopened = await JournalRecordingService.open(
      {
        sessionId: 'session-a',
        projectHash: PROJECT,
        chatsDir: chats,
        workspaceDirs: ['/work/a'],
        provider: 'anthropic',
        model: 'model-1',
        journal: journalSeams(),
      },
      file,
    );
    reopened.recordFirstUserPreview('other');
    await reopened.flush();
    await reopened.dispose();
    expect(await SessionDiscovery.readFirstUserMessage(file)).toBe('one');
  });

  it('has no preview and no content for a session that holds no user message', async () => {
    const chats = chatsDirIn(directory());
    const { filePath } = await recordJournal(chats, 'session-empty', {});

    const [summary] = await SessionDiscovery.listSessions(chats, PROJECT);

    expect(summary.preview).toBeUndefined();
    expect(summary.messageCount).toBe(0);
    expect(await SessionDiscovery.readFirstUserMessage(filePath)).toBeNull();
    expect(await SessionDiscovery.hasContentEvents(filePath)).toBe(false);
  });

  it('reads the title of a journal session', async () => {
    const chats = chatsDirIn(directory());
    const { filePath } = await recordJournal(chats, 'session-t', {
      title: 'A title',
    });

    expect(await SessionDiscovery.readSessionMetadataTitle(filePath)).toBe(
      'A title',
    );
  });

  it('lists a retired JSONL file as unreadable with the refusal message and still lists the journal sessions', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-good', { rows: [userRow('hi')] });
    const retired = path.join(chats, 'session-old.jsonl');
    await fsp.writeFile(retired, '{"v":2}\n');

    const listed = await SessionDiscovery.listSessionsDetailed(chats, PROJECT);

    expect(listed.sessions.map((s) => s.sessionId)).toStrictEqual([
      'session-good',
    ]);
    expect(listed.unreadableRecordings).toStrictEqual([
      { filePath: retired, reason: retiredJournalMessage(retired) },
    ]);
    expect(listed.skippedCount).toBe(1);
  });
});
