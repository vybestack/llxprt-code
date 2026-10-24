/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { testJournalSeams } from '../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { IContent } from '../services/history/IContent.js';
import { CONTINUE_LATEST } from './continueLatest.js';
import { resumeSession } from './resumeSession.js';
import { createRowCounters } from './journalCounters.js';
import { RowOwnership } from './rowOwnership.js';
import {
  resumeJournalSession,
  resumedRows,
  type JournalResumeRequest,
  type JournalResumeResult,
} from './journalResume.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SESSION_KEYS, decodeProviderFact } from './sessionMetaKeys.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

const OLDER = new Date('2026-01-01T00:00:00Z');
const NEWER = new Date('2026-02-01T00:00:00Z');

function aiRow(text: string, stored: boolean): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(stored ? { metadata: { id: 'resp_1', responsesStored: true } } : {}),
  };
}

describe('resuming a session on the journal', () => {
  const directory = useTempDir('journal-resume-');
  const resumed: JournalResumeResult[] = [];
  afterEach(async () => {
    for (const result of resumed.splice(0)) {
      await result.recording.dispose().catch(() => undefined);
    }
  });

  function request(
    continueRef: string,
    overrides: Partial<JournalResumeRequest> = {},
  ): JournalResumeRequest {
    return {
      continueRef,
      projectHash: PROJECT,
      chatsDir: chatsDirIn(directory()),
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/work/a'],
      journal: journalSeams(),
      ...overrides,
    };
  }

  async function resume(
    continueRef: string,
    overrides: Partial<JournalResumeRequest> = {},
  ): Promise<JournalResumeResult> {
    const result = await resumeJournalSession(request(continueRef, overrides));
    if (!result.ok) throw new Error(result.error);
    resumed.push(result);
    return result;
  }

  async function historyOf(result: JournalResumeResult): Promise<string[]> {
    const session = await result.recording.session();
    const texts: string[] = [];
    for await (const row of resumedRows(session, result.resumePoint)) {
      const block = row.content.blocks[0];
      if (block.type === 'text') texts.push(block.text);
    }
    return texts;
  }

  it('charges a suspended resume row and releases it on return, throw and exhaustion', async () => {
    await recordJournal(chatsDirIn(directory()), 'counted', {
      rows: [userRow('one'), userRow('two')],
    });
    const ownership = new RowOwnership();
    const counters = createRowCounters();
    const result = await resumeSession({
      ...request('counted'),
      counters: { ...counters.counters, ownership },
    });
    if (!result.ok) throw new Error(result.error);
    const returned = result.boot.streamRows()[Symbol.asyncIterator]();
    const failed = result.boot.streamRows()[Symbol.asyncIterator]();
    try {
      expect((await returned.next()).done).toBe(false);
      expect(ownership.snapshot().liveRows).toBe(1);
      await returned.return(undefined);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect((await failed.next()).done).toBe(false);
      expect(ownership.snapshot().liveRows).toBe(1);
      const failure = new Error('resume consumer failed');
      await expect(failed.throw(failure)).rejects.toBe(failure);
      expect(ownership.snapshot().liveRows).toBe(0);
      const texts: string[] = [];
      for await (const row of result.boot.streamRows()) {
        expect(ownership.snapshot().liveRows).toBe(1);
        const block = row.blocks[0];
        if (block.type !== 'text') throw new Error('Missing text');
        texts.push(block.text);
      }
      expect(texts).toStrictEqual(['one', 'two']);
      expect(ownership.snapshot()).toMatchObject({
        liveRows: 0,
        peakRows: 1,
        acquisitions: 4,
      });
      expect(counters.snapshot()).toMatchObject({
        rowsDecoded: 4,
        peakDecodedRows: 1,
      });
    } finally {
      await returned.return(undefined);
      await failed.return(undefined);
      await result.recording.dispose();
    }
  });

  it('resumes the newest session with its facts and its rows, holding the session lock', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-old', {
      rows: [userRow('old')],
      modifiedAt: OLDER,
    });
    await recordJournal(chats, 'session-new', {
      rows: [userRow('one'), userRow('two'), userRow('three')],
      title: 'Newest',
      modifiedAt: NEWER,
    });

    const result = await resume(CONTINUE_LATEST);

    expect(result.metadata).toMatchObject({
      sessionId: 'session-new',
      projectHash: PROJECT,
      provider: 'anthropic',
      model: 'model-1',
      workspaceDirs: ['/work/a'],
      kind: 'main',
      title: 'Newest',
    });
    expect(result.resumePoint.rows).toBe(3);
    expect(result.resumePoint.commitSeq).toBeGreaterThan(0);
    expect(await historyOf(result)).toStrictEqual(['one', 'two', 'three']);
    expect(await SessionLockManager.isLocked(chats, 'session-new')).toBe(true);
    expect(await SessionLockManager.isLocked(chats, 'session-old')).toBe(false);
  });

  it('keeps writing to the resumed file', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-a', { rows: [userRow('before')] });
    const first = await resume('session-a');
    await (await first.recording.session()).append([userRow('after')]);
    await first.recording.dispose();

    const second = await resume('session-a');

    expect(await historyOf(second)).toStrictEqual(['before', 'after']);
  });

  it('resolves a session by id prefix and by list index', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-aaaa', {
      rows: [userRow('a')],
      modifiedAt: OLDER,
    });
    await recordJournal(chats, 'session-bbbb', {
      rows: [userRow('b')],
      modifiedAt: NEWER,
    });

    const byPrefix = await resume('session-aa');
    expect(byPrefix.metadata.sessionId).toBe('session-aaaa');
    await byPrefix.recording.dispose();
    const byIndex = await resume('1');

    expect(byIndex.metadata.sessionId).toBe('session-bbbb');
  });

  it('drops the stored Responses chain marker of rows an earlier process wrote, not of rows written after the resume', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-a', {
      rows: [userRow('ask'), aiRow('earlier answer', true)],
    });
    const result = await resume('session-a');
    const session = await result.recording.session();
    await session.append([aiRow('later answer', true)]);

    const markers: Array<boolean | undefined> = [];
    for await (const row of resumedRows(session, result.resumePoint)) {
      if (row.content.speaker === 'ai') {
        markers.push(row.content.metadata?.responsesStored);
      }
    }

    expect(markers).toStrictEqual([undefined, true]);
  });

  it('refuses a named retired JSONL file with the single message, never opens it, holds no lock', async () => {
    const chats = chatsDirIn(directory());
    await fsp.mkdir(chats, { recursive: true });
    const name = 'session-2026-01-01T00-00-00-a-aaaaaaaa.jsonl';
    const retired = path.join(chats, name);
    await fsp.writeFile(retired, '{"v":2,"seq":1,"type":"session_start"}\n');
    const before = await fsp.readFile(retired);

    const result = await resumeJournalSession(request(name));

    expect(result).toMatchObject({
      ok: false,
      error: retiredJournalMessage(retired),
    });
    expect(result.skippedRecordings).toStrictEqual([
      { filePath: retired, reason: retiredJournalMessage(retired) },
    ]);
    expect(await fsp.readFile(retired)).toStrictEqual(before);
  });

  it('reports a project with only retired files without throwing, naming each file', async () => {
    const chats = chatsDirIn(directory());
    await fsp.mkdir(chats, { recursive: true });
    const retired = path.join(chats, 'session-x.jsonl');
    await fsp.writeFile(retired, '{"v":2}\n');

    const result = await resumeJournalSession(request(CONTINUE_LATEST));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(
      retiredJournalMessage(retired),
    );
  });

  it('resumes the readable session and reports the retired file it passed over', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-good', {
      rows: [userRow('good')],
      modifiedAt: OLDER,
    });
    const retired = path.join(chats, 'session-zzz.jsonl');
    await fsp.writeFile(retired, '{"v":2}\n');
    await fsp.utimes(retired, NEWER, NEWER);

    const result = await resume(CONTINUE_LATEST);

    expect(result.metadata.sessionId).toBe('session-good');
    expect(result.skippedRecordings.map((r) => r.filePath)).toStrictEqual([
      retired,
    ]);
  });

  it('releases the lock and reports the reason when a journal cannot be opened for its owner', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-a', {
      rows: [userRow('a')],
      modifiedAt: OLDER,
    });
    await recordJournal(chats, 'session-b', {
      rows: [userRow('b')],
      modifiedAt: NEWER,
    });
    const failing = {
      journal: {
        ...testJournalSeams().dependencies,
        open: () => Promise.reject(new Error('disk gone')),
      },
    };

    const result = await resumeJournalSession(
      request(CONTINUE_LATEST, { journal: failing }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'Failed to replay session: disk gone',
    });
    expect(result.skippedRecordings.map((r) => r.sessionId)).toStrictEqual([
      'session-b',
      'session-a',
    ]);
    expect(await SessionLockManager.isLocked(chats, 'session-a')).toBe(false);
    expect(await SessionLockManager.isLocked(chats, 'session-b')).toBe(false);
  });

  it('skips a session another process holds, and says so when it is the only one', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-held', { rows: [userRow('x')] });
    const held = await SessionLockManager.acquire(chats, 'session-held');

    const result = await resumeJournalSession(request(CONTINUE_LATEST));
    const named = await resumeJournalSession(request('session-held'));
    await held.release();

    expect(result).toMatchObject({
      ok: false,
      error: 'All sessions for this project are in use',
    });
    expect(named).toMatchObject({
      ok: false,
      error: 'Session is in use by another process',
    });
  });

  it('records a provider change the way the JSONL resume did', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-a', { rows: [userRow('x')] });

    const result = await resume('session-a', {
      currentProvider: 'openai',
      currentModel: 'gpt',
    });
    await result.recording.flush();
    const { store } = await result.recording.session();

    expect(result.metadata.provider).toBe('anthropic');
    expect(
      decodeProviderFact((await store.getState(SESSION_KEYS.provider))!),
    ).toStrictEqual({ provider: 'openai', model: 'gpt' });
  });

  it('takes the resume point after the facts the resume itself records', async () => {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-a', { rows: [userRow('one')] });

    const result = await resume('session-a', {
      currentProvider: 'openai',
      currentModel: 'gpt',
    });
    await result.recording.flush();
    const { store } = await result.recording.session();

    expect(store.published?.commitSeq).toBe(result.resumePoint.commitSeq);
    expect(result.resumePoint.rows).toBe(1);
  });

  it('opens to the previous version when the last group was cut short', async () => {
    const chats = chatsDirIn(directory());
    const { filePath } = await recordJournal(chats, 'session-a', {
      rows: [userRow('kept')],
    });
    const whole = await resume('session-a');
    const wholeSeq = whole.resumePoint.commitSeq;
    await (await whole.recording.session()).append([userRow('lost')]);
    await whole.recording.dispose();
    const size = (await fsp.stat(filePath)).size;
    await fsp.truncate(filePath, size - 3);

    const result = await resume('session-a');

    expect(result.resumePoint.commitSeq).toBe(wholeSeq);
    expect(await historyOf(result)).toStrictEqual(['kept']);
  });
});
