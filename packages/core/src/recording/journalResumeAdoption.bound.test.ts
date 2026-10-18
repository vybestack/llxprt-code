/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { createHistoryStore } from '../services/history/historyBackend.js';
import type { ResumeDerivedState } from '../services/history/historyResumeAdoption.js';
import type { HistoryStorePort } from '../services/history/historyStorePort.js';
import type { IContent } from '../services/history/IContent.js';
import type { JournalAdoption } from '../services/history/journalAdoption.js';
import { JournalHistoryStore } from '../services/history/journalHistoryStore.js';
import { JournalSession } from '../services/history/journalSession.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
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
    metadata: { id: `resp_${text}`, responsesStored: true },
  };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

async function fileTexts(recorder: JournalRecordingService): Promise<string[]> {
  await recorder.flush();
  const texts: string[] = [];
  for await (const { content } of (await recorder.session()).rows()) {
    texts.push(textOf(content));
  }
  return texts;
}

async function drain(rows: AsyncIterable<IContent>): Promise<IContent[]> {
  const all: IContent[] = [];
  for await (const row of rows) all.push(row);
  return all;
}

function stored(rows: readonly IContent[]): Array<boolean | undefined> {
  return rows.map((row) => row.metadata?.responsesStored);
}

describe('adopting a resumed journal while recorders are bound', () => {
  const directory = useTempDir('journal-resume-adoption-bound-');
  const stores: JournalHistoryStore[] = [];
  const sessions: JournalSession[] = [];
  const recorders: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    for (const recorder of recorders.splice(0)) {
      await recorder.dispose().catch(() => undefined);
    }
    for (const session of sessions.splice(0)) await session.close();
  });

  function config(sessionId: string): JournalRecordingConfig {
    return {
      sessionId,
      projectHash: PROJECT,
      chatsDir: chatsDirIn(directory()),
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: journalSeams(),
    };
  }

  function recorder(sessionId: string): JournalRecordingService {
    const created = JournalRecordingService.create(config(sessionId));
    recorders.push(created);
    return created;
  }

  async function liveStore(): Promise<JournalHistoryStore> {
    const primary = await JournalSession.create(
      path.join(directory(), 'primary.llxj'),
    );
    sessions.push(primary);
    const store = new JournalHistoryStore(primary);
    stores.push(store);
    return store;
  }

  async function settle(store: JournalHistoryStore): Promise<void> {
    await store.waitForDurable();
    await store.settleFanout();
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
    recorders.push(result.recording);
    return result;
  }

  async function bytesOf(rec: JournalRecordingService): Promise<Buffer> {
    await rec.flush();
    const file = rec.getFilePath();
    if (file === null) throw new Error('the recorder wrote no file');
    return fsp.readFile(file);
  }

  it('does not retire a subscription installed on the newly adopted primary', async () => {
    const live = recorder('previous-listener-session');
    const store = await liveStore();
    store.apply({ kind: 'content', content: userRow('previous') });
    await store.attachJournal(live, true);
    await settle(store);
    const resumed = await resumeRecorded([userRow('resumed')]);
    let priorRetirements = 0;
    let nextRetirements = 0;
    store.onRetired(() => {
      priorRetirements += 1;
    });
    const adoption = await store.adoptJournal(
      resumed.recording,
      resumed.resumePoint,
    );
    store.onRetired(() => {
      nextRetirements += 1;
    });
    await adoption.commit();
    expect(priorRetirements).toBe(1);
    expect(nextRetirements).toBe(0);
    store.apply({ kind: 'content', content: userRow('after adoption') });
    await settle(store);
    expect(await fileTexts(resumed.recording)).toStrictEqual([
      'resumed',
      'after adoption',
    ]);
  });

  it('retires the live recorder, writes to the resumed file only and leaves the live file as it was', async () => {
    const live = recorder('session-live');
    const store = await liveStore();
    store.apply({ kind: 'content', content: userRow('live one') });
    await store.attachJournal(live, true);
    await settle(store);
    const resumed = await resumeRecorded([userRow('ask'), aiRow('answer')]);
    let retired = 0;
    store.onRetired(() => (retired += 1));
    const liveBytes = await bytesOf(live);

    const adoption = await store.adoptJournal(
      resumed.recording,
      resumed.resumePoint,
    );
    await adoption.commit();
    store.apply({ kind: 'content', content: userRow('next') });
    await settle(store);

    expect(retired).toBe(1);
    expect(store.isRecorder(live)).toBe(false);
    expect(store.isAdoptingRecorder(resumed.recording)).toBe(true);
    expect(await fileTexts(resumed.recording)).toStrictEqual([
      'ask',
      'answer',
      'next',
    ]);
    expect((await bytesOf(live)).equals(liveBytes)).toBe(true);
  });

  it('puts the live recorder back when the adoption is rolled back, and fires nothing', async () => {
    const live = recorder('session-live');
    const store = await liveStore();
    store.apply({ kind: 'content', content: userRow('live one') });
    await store.attachJournal(live, true);
    await settle(store);
    const resumed = await resumeRecorded([userRow('ask')]);
    let retired = 0;
    store.onRetired(() => (retired += 1));
    const resumedBytes = await bytesOf(resumed.recording);

    const adoption = await store.adoptJournal(
      resumed.recording,
      resumed.resumePoint,
    );
    await adoption.rollback();
    store.apply({ kind: 'content', content: userRow('live two') });
    await settle(store);

    expect(retired).toBe(0);
    expect(store.isRecorder(live)).toBe(true);
    expect(store.isAdoptingRecorder(resumed.recording)).toBe(false);
    expect(await fileTexts(live)).toStrictEqual(['live one', 'live two']);
    expect((await bytesOf(resumed.recording)).equals(resumedBytes)).toBe(true);
    const rows = await drain(store.streamRows());
    expect(rows.map(textOf)).toStrictEqual(['live one', 'live two']);
  });

  it('resyncs the mirror of another origin to the resumed rows and keeps feeding it', async () => {
    const live = recorder('session-live');
    const other = recorder('session-other');
    const store = await liveStore();
    store.apply({ kind: 'content', content: userRow('live one') });
    store.apply({
      kind: 'content',
      content: userRow('b one'),
      origin: 'agent-b',
    });
    await store.attachJournal(live, true);
    await store.attachJournal(other, true, undefined, 'agent-b');
    await settle(store);
    expect(await fileTexts(other)).toStrictEqual(['live one', 'b one']);
    const resumed = await resumeRecorded([userRow('ask')]);

    const adoption = await store.adoptJournal(
      resumed.recording,
      resumed.resumePoint,
    );
    await adoption.commit();
    store.apply({
      kind: 'content',
      content: userRow('b two'),
      origin: 'agent-b',
    });
    await settle(store);

    expect(store.isRecorder(other)).toBe(true);
    expect(store.isRecorder(live)).toBe(false);
    expect(await fileTexts(other)).toStrictEqual(['ask', 'b two']);
  });

  it('retires a previously adopted recorder when the next resume is adopted', async () => {
    const store = await liveStore();
    const first = await resumeRecorded([userRow('first')]);
    await (
      await store.adoptJournal(first.recording, first.resumePoint)
    ).commit();
    let retired = 0;
    store.onRetired(() => (retired += 1));
    const chats = chatsDirIn(directory());
    await recordJournal(chats, 'session-b', { rows: [userRow('second')] });
    const second = await resumeJournalSession({
      continueRef: 'session-b',
      projectHash: PROJECT,
      chatsDir: chats,
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/work/a'],
      journal: journalSeams(),
    });
    if (!second.ok) throw new Error(second.error);
    recorders.push(second.recording);
    const firstBytes = await bytesOf(first.recording);

    await (
      await store.adoptJournal(second.recording, second.resumePoint)
    ).commit();
    store.apply({ kind: 'content', content: userRow('after') });
    await settle(store);

    expect(retired).toBe(1);
    expect(await fileTexts(second.recording)).toStrictEqual([
      'second',
      'after',
    ]);
    expect((await bytesOf(first.recording)).equals(firstBytes)).toBe(true);
  });

  describe('adoptResume on the port', () => {
    function request(
      resumed: JournalResumeResult,
      log: string[],
      afterPublication: () => void = () => log.push('after'),
    ): Parameters<HistoryStorePort['adoptResume']>[0] {
      return {
        recording: resumed.recording,
        boot: resumed.resumePoint,
        estimate: (rows) => Promise.resolve(rows.length * 10),
        publish: () => log.push('publish'),
        restore: () => log.push('restore'),
        afterPublication,
      };
    }

    it('adopts a resume onto a history whose live recorder is bound, publishing the derived state once', async () => {
      const live = recorder('session-live');
      const store = await liveStore();
      const port: Pick<HistoryStorePort, 'adoptResume'> = store;
      store.apply({ kind: 'content', content: userRow('live one') });
      await store.attachJournal(live, true);
      await settle(store);
      const resumed = await resumeRecorded([userRow('ask'), aiRow('answer')]);
      const states: ResumeDerivedState[] = [];
      const log: string[] = [];

      const warnings = await port.adoptResume({
        ...request(resumed, log),
        publish: (state) => states.push(state),
      });
      store.apply({ kind: 'content', content: userRow('next') });
      await settle(store);

      expect(warnings).toStrictEqual([]);
      expect(states).toHaveLength(1);
      expect(states[0].tokens).toBe(20);
      expect(store.isRecorder(live)).toBe(false);
      expect(await fileTexts(resumed.recording)).toStrictEqual([
        'ask',
        'answer',
        'next',
      ]);
    });

    it('rolls everything back when a step after the swap fails, and the live recorder keeps writing', async () => {
      const live = recorder('session-live');
      const store = await liveStore();
      store.apply({ kind: 'content', content: userRow('live one') });
      await store.attachJournal(live, true);
      await settle(store);
      const resumed = await resumeRecorded([userRow('ask')]);
      const log: string[] = [];
      let retired = 0;
      store.onRetired(() => (retired += 1));

      await expect(
        store.adoptResume(
          request(resumed, log, () => {
            throw new Error('after publication failed');
          }),
        ),
      ).rejects.toThrow('after publication failed');
      store.apply({ kind: 'content', content: userRow('live two') });
      await settle(store);

      expect(log).toStrictEqual(['publish', 'restore']);
      expect(retired).toBe(0);
      expect(store.isRecorder(live)).toBe(true);
      expect(await fileTexts(live)).toStrictEqual(['live one', 'live two']);
    });

    it('is refused by the journal store for a JSONL recorder', async () => {
      const resumed = await resumeRecorded([userRow('ask')]);
      const jsonl = new SessionRecordingService({
        sessionId: 'session-jsonl',
        projectHash: PROJECT,
        chatsDir: chatsDirIn(directory()),
        workspaceDirs: ['/work/a'],
        provider: 'anthropic',
        model: 'model-1',
      });
      const store = await liveStore();

      await expect(
        store.adoptResume({ ...request(resumed, []), recording: jsonl }),
      ).rejects.toThrow('Recorder/backend mismatch');
      await jsonl.dispose();
    });

    it('is refused by the JSONL store for a journal resume point, even with its own kind of recorder', async () => {
      const resumed = await resumeRecorded([userRow('ask')]);
      const jsonl = new SessionRecordingService({
        sessionId: 'session-jsonl',
        projectHash: PROJECT,
        chatsDir: chatsDirIn(directory()),
        workspaceDirs: ['/work/a'],
        provider: 'anthropic',
        model: 'model-1',
      });
      const old = createHistoryStore({}, 'old');
      try {
        await expect(
          old.adoptResume({ ...request(resumed, []), recording: jsonl }),
        ).rejects.toThrow('Recorder/backend mismatch');
      } finally {
        await old.dispose();
        await jsonl.dispose();
      }
    });

    it('is refused by the JSONL store, which resumes only from its own recorder and cursor', async () => {
      const resumed = await resumeRecorded([userRow('ask')]);
      const old = createHistoryStore({}, 'old');
      try {
        await expect(old.adoptResume(request(resumed, []))).rejects.toThrow(
          'Recorder/backend mismatch',
        );
      } finally {
        await old.dispose();
      }
    });
  });

  describe('the resume boundary on every read', () => {
    async function adopted(): Promise<{
      store: JournalHistoryStore;
      adoption: JournalAdoption;
    }> {
      const store = await liveStore();
      const resumed = await resumeRecorded([userRow('ask'), aiRow('old')]);
      const adoption = await store.adoptJournal(
        resumed.recording,
        resumed.resumePoint,
      );
      store.apply({ kind: 'content', content: aiRow('new') });
      await store.waitForDurable();
      return { store, adoption };
    }

    it('streamRows clears the marker of resumed rows only', async () => {
      const { store } = await adopted();
      expect(stored(await drain(store.streamRows()))).toStrictEqual([
        undefined,
        undefined,
        true,
      ]);
    });

    it('a dump clears the marker of resumed rows only', async () => {
      const { store } = await adopted();
      const dump = await store.openDumpSnapshot();
      try {
        expect(stored(await drain(dump.rows()))).toStrictEqual([
          undefined,
          undefined,
          true,
        ]);
      } finally {
        await dump.close();
      }
    });

    it('a committed batch clears the marker of resumed rows only', async () => {
      const { store } = await adopted();
      const batch = await store.committedBatch();
      try {
        expect(stored(await drain(batch.rows()))).toStrictEqual([
          undefined,
          undefined,
          true,
        ]);
      } finally {
        batch.retire();
      }
    });

    it('the row view and the newest row of a speaker clear the marker of resumed rows only', async () => {
      const { store } = await adopted();
      const viewed = await store.readRows((view) => drain(view.rows()));
      expect(stored(viewed)).toStrictEqual([undefined, undefined, true]);
      expect((await store.lastContent('ai'))?.metadata?.responsesStored).toBe(
        true,
      );
      store.apply({ kind: 'rewind', itemsRemoved: 1 });
      await store.waitForDurable();
      expect(
        (await store.lastContent('ai'))?.metadata?.responsesStored,
      ).toBeUndefined();
    });

    it('a rolled-back adoption brings back the boundary of the prior history', async () => {
      const { store, adoption } = await adopted();
      await adoption.rollback();
      expect(store.resumeBoundary).toBeUndefined();
    });
  });
});
