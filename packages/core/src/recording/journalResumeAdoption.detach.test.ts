/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalHistoryStore } from '../services/history/journalHistoryStore.js';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { adoptResumedJournal } from './journalResumeAdoption.js';
import {
  resumeJournalSession,
  type JournalResumeResult,
} from './journalResume.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

async function historyOf(store: JournalHistoryStore): Promise<string[]> {
  const texts: string[] = [];
  for await (const row of store.streamRows()) texts.push(textOf(row));
  return texts;
}

describe('stopping the recording that is the adopted primary (D-ORCH-11)', () => {
  const directory = useTempDir('journal-adopted-detach-');
  const stores: JournalHistoryStore[] = [];
  const sessions: JournalSession[] = [];
  const resumed: JournalResumeResult[] = [];
  const others: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    for (const result of resumed.splice(0)) {
      await result.recording.dispose().catch(() => undefined);
    }
    for (const other of others.splice(0)) {
      await other.dispose().catch(() => undefined);
    }
    for (const session of sessions.splice(0)) await session.close();
  });

  async function adoptedStore(
    rows: IContent[],
  ): Promise<{ store: JournalHistoryStore; result: JournalResumeResult }> {
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-a', { rows });
    const result = await resumeJournalSession({
      continueRef: 'session-a',
      projectHash: PROJECT,
      chatsDir: chats,
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/work/a'],
      journal: journalSeams(),
    });
    if (!result.ok) throw new Error(result.error);
    resumed.push(result);
    const primary = await JournalSession.create(
      path.join(directory(), 'primary.llxj'),
    );
    sessions.push(primary);
    const store = new JournalHistoryStore(primary);
    stores.push(store);
    await adoptResumedJournal({
      journal: store,
      recording: result.recording,
      resumePoint: result.resumePoint,
      estimate: (all) => Promise.resolve(all.length * 10),
      publish: () => undefined,
      restore: () => undefined,
      afterPublication: () => undefined,
    });
    return { store, result };
  }

  function sizeOf(filePath: string | null): number {
    if (filePath === null) throw new Error('the recorder wrote no file');
    return fs.statSync(filePath).size;
  }

  it('moves the history off the session file: the recorder can close and later rows stay out of that file', async () => {
    const { store, result } = await adoptedStore([
      userRow('ask'),
      userRow('answer'),
    ]);
    const filePath = result.recording.getFilePath();

    await store.detachJournal(result.recording);
    await result.recording.dispose();
    const sizeAfterDetach = sizeOf(filePath);
    store.apply({ kind: 'content', content: userRow('next') });
    await store.waitForDurable();

    expect(await historyOf(store)).toStrictEqual(['ask', 'answer', 'next']);
    expect(store.getLength()).toBe(3);
    expect(sizeOf(filePath)).toBe(sizeAfterDetach);
    expect(store.isAdoptingRecorder(result.recording)).toBe(false);
    expect(store.journalPath()).not.toBe(filePath);
  });

  it('keeps a recorder of another origin bound, and it receives the later rows', async () => {
    const { store, result } = await adoptedStore([userRow('ask')]);
    const other = JournalRecordingService.create({
      sessionId: 'session-other',
      projectHash: PROJECT,
      chatsDir: chatsDirIn(directory()),
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: journalSeams(),
    });
    others.push(other);
    await store.attachJournal(other, true, undefined, 'agent-b');

    await store.detachJournal(result.recording);
    await result.recording.dispose();
    store.apply({ kind: 'content', content: userRow('next') });
    await store.waitForDurable();
    await store.settleFanout();

    expect(store.isRecorder(other)).toBe(true);
    const texts: string[] = [];
    for await (const { content } of (await other.session()).rows()) {
      texts.push(textOf(content));
    }
    expect(texts).toStrictEqual(['ask', 'next']);
  });
});
