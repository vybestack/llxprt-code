/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalHistoryStore } from '../services/history/journalHistoryStore.js';
import { JournalSession } from '../services/history/journalSession.js';
import {
  adoptResumedJournal,
  type JournalResumeAdoptionInput,
  type JournalResumeState,
} from './journalResumeAdoption.js';
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

function aiRow(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { id: 'resp_1', responsesStored: true },
  };
}

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

describe('adopting a resumed journal on the history store', () => {
  const directory = useTempDir('journal-resume-adoption-');
  const stores: JournalHistoryStore[] = [];
  const sessions: JournalSession[] = [];
  const resumed: JournalResumeResult[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    for (const result of resumed.splice(0)) {
      await result.recording.dispose().catch(() => undefined);
    }
    for (const session of sessions.splice(0)) await session.close();
  });

  async function freshStore(): Promise<JournalHistoryStore> {
    const primary = await JournalSession.create(
      path.join(directory(), 'primary.llxj'),
    );
    sessions.push(primary);
    const store = new JournalHistoryStore(primary);
    stores.push(store);
    store.apply({ kind: 'content', content: userRow('fresh') });
    await store.waitForDurable();
    return store;
  }

  async function resumeRecorded(
    rows: IContent[],
  ): Promise<JournalResumeResult> {
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
    return result;
  }

  function input(
    journal: JournalHistoryStore,
    result: JournalResumeResult,
    overrides: Partial<JournalResumeAdoptionInput> = {},
  ): JournalResumeAdoptionInput & {
    states: JournalResumeState[];
    log: string[];
  } {
    const states: JournalResumeState[] = [];
    const log: string[] = [];
    return {
      journal,
      recording: result.recording,
      resumePoint: result.resumePoint,
      estimate: (rows) => Promise.resolve(rows.length * 10),
      publish: (state) => {
        states.push(state);
        log.push('publish');
      },
      restore: () => {
        log.push('restore');
      },
      afterPublication: () => {
        log.push('after');
      },
      ...overrides,
      states,
      log,
    };
  }

  it('makes the resumed file the history, derives the state from its rows and keeps writing to it', async () => {
    const result = await resumeRecorded([userRow('ask'), aiRow('answer')]);
    const store = await freshStore();
    const request = input(store, result);

    const warnings = await adoptResumedJournal(request);

    expect(warnings).toStrictEqual([]);
    expect(request.log).toStrictEqual(['publish', 'after']);
    expect(request.states[0].tokens).toBe(20);
    expect(request.states[0].range.totalEntries).toBe(2);
    expect(store.getLength()).toBe(2);
    expect(store.isAdoptingRecorder(result.recording)).toBe(true);
    expect(result.recording.getFilePath()).toBe(store.journalPath());
    expect(await historyOf(store)).toStrictEqual(['ask', 'answer']);
    store.apply({ kind: 'content', content: userRow('next') });
    await store.waitForDurable();
    const session = await result.recording.session();
    const onDisk: string[] = [];
    for await (const row of session.rows()) onDisk.push(textOf(row.content));
    expect(onDisk).toStrictEqual(['ask', 'answer', 'next']);
  });

  it('reads the resumed history through resumedRows, so the Responses chain marker of earlier rows is gone', async () => {
    const result = await resumeRecorded([userRow('ask'), aiRow('answer')]);
    const store = await freshStore();
    const seen: Array<boolean | undefined> = [];

    await adoptResumedJournal(
      input(store, result, {
        estimate: (rows) => {
          for (const row of rows) seen.push(row.metadata?.responsesStored);
          return Promise.resolve(1);
        },
      }),
    );

    expect(seen).toStrictEqual([undefined, undefined]);
  });

  it('keeps the prior store when a step after the swap fails, and reports the error', async () => {
    const result = await resumeRecorded([userRow('ask')]);
    const store = await freshStore();
    const priorPath = store.journalPath();
    const request = input(store, result, {
      afterPublication: () => {
        throw new Error('after publication failed');
      },
    });

    await expect(adoptResumedJournal(request)).rejects.toThrow(
      'after publication failed',
    );

    expect(request.log).toStrictEqual(['publish', 'restore']);
    expect(store.journalPath()).toBe(priorPath);
    expect(store.isAdoptingRecorder(result.recording)).toBe(false);
    expect(store.getLength()).toBe(1);
    store.apply({ kind: 'content', content: userRow('still works') });
    await store.waitForDurable();
    expect(await historyOf(store)).toStrictEqual(['fresh', 'still works']);
    const session = await result.recording.session();
    expect(session.store.published?.rows).toBe(1);
  });

  it.each([
    [
      'a row was appended',
      async (result: JournalResumeResult) => {
        await (await result.recording.session()).append([userRow('late')]);
      },
    ],
    [
      'only a session fact was written',
      async (result: JournalResumeResult) => {
        result.recording.recordSessionMetadata('moved');
        await result.recording.flush();
      },
    ],
  ])(
    'refuses a file that moved since the resume was read (%s), leaving the prior store in place',
    async (_name, move) => {
      const result = await resumeRecorded([userRow('ask')]);
      const store = await freshStore();
      await move(result);
      const request = input(store, result);

      await expect(adoptResumedJournal(request)).rejects.toThrow(
        /the resume read commit/,
      );

      expect(request.log).toStrictEqual(['restore']);
      expect(store.isAdoptingRecorder(result.recording)).toBe(false);
      expect(await historyOf(store)).toStrictEqual(['fresh']);
    },
  );

  it('refuses a history that has recorders bound', async () => {
    const result = await resumeRecorded([userRow('ask')]);
    const store = await freshStore();
    const mirror = await JournalSession.create(
      path.join(directory(), 'mirror.llxj'),
    );
    sessions.push(mirror);
    await store.mirrors.attach(mirror, 'agent-a');
    const request = input(store, result);

    await expect(adoptResumedJournal(request)).rejects.toThrow(
      'cannot adopt a resumed journal',
    );

    expect(request.log).toStrictEqual(['restore']);
  });

  it('a settled adoption cannot be settled again', async () => {
    const result = await resumeRecorded([userRow('ask')]);
    const store = await freshStore();
    const adoption = await store.adoptJournal(
      result.recording,
      result.resumePoint,
    );

    await adoption.commit();

    await expect(adoption.rollback()).rejects.toThrow('already settled');
    await expect(adoption.commit()).rejects.toThrow('already settled');
  });
});
