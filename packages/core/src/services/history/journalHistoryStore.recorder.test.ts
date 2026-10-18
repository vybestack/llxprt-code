/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { JournalRecordingConfig } from '../../recording/journalRecordingService.js';
import { readJournalFileFacts } from '../../recording/journalSessionListing.js';
import { SESSION_KEYS } from '../../recording/sessionMetaKeys.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

const FIRST_SESSION = 'session-aaaaaaaa-1111';
const SECOND_SESSION = 'session-bbbbbbbb-2222';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

async function texts(recorder: JournalRecordingService): Promise<string[]> {
  const rows: string[] = [];
  for await (const { content } of (await recorder.session()).rows()) {
    rows.push(textOf(content));
  }
  return rows;
}

/** The `session:preview` fact that is in the recorder's file now. */
async function previewOfFile(
  recorder: JournalRecordingService,
): Promise<string | undefined> {
  const filePath = recorder.getFilePath();
  if (filePath === null) throw new Error('the recorder wrote no file');
  return (await readJournalFileFacts(filePath))?.preview;
}

/** The preview a recorder holds once its own queue has drained. */
async function previewOfRecorder(
  recorder: JournalRecordingService,
): Promise<string | undefined> {
  await recorder.flush();
  return previewOfFile(recorder);
}

describe('journal history store over a journal recorder', () => {
  const directory = useTempDir('journal-history-recorder-');
  const stores: JournalHistoryStore[] = [];
  const recorders: JournalRecordingService[] = [];
  const sessions: JournalSession[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    for (const recorder of recorders.splice(0)) {
      await recorder.dispose().catch(() => undefined);
    }
    for (const session of sessions.splice(0)) await session.close();
  });

  function config(
    sessionId: string,
    overrides: Partial<JournalRecordingConfig> = {},
  ): JournalRecordingConfig {
    return {
      sessionId,
      projectHash: 'project',
      chatsDir: path.join(directory(), 'chats'),
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: { journal: testJournalSeams().dependencies },
      ...overrides,
    };
  }

  function recorder(
    sessionId = FIRST_SESSION,
    overrides: Partial<JournalRecordingConfig> = {},
  ): JournalRecordingService {
    const created = JournalRecordingService.create(
      config(sessionId, overrides),
    );
    recorders.push(created);
    return created;
  }

  async function newStore(name = 'primary.llxj'): Promise<JournalHistoryStore> {
    const primary = await JournalSession.create(path.join(directory(), name));
    sessions.push(primary);
    const store = new JournalHistoryStore(primary);
    stores.push(store);
    return store;
  }

  /** What an awaited mutation boundary promises: the history and every recorder are durable. */
  async function boundary(store: JournalHistoryStore): Promise<void> {
    await store.waitForDurable();
    await store.settleFanout();
  }

  describe('attachJournal, detachJournal and isRecorder', () => {
    it('keeps an empty attachment unmaterialized until its first content group', async () => {
      const store = await newStore();
      const rec = recorder();
      await store.attachJournal(rec, true, undefined, 'agent-a');
      await boundary(store);
      expect(store.isRecorder(rec)).toBe(true);
      expect(rec.getFilePath()).toBeNull();
      store.apply({
        kind: 'content',
        content: row('first recorded turn'),
        origin: 'agent-a',
      });
      await boundary(store);
      expect(await texts(rec)).toStrictEqual(['first recorded turn']);
      expect((await readJournalFileFacts(rec.getFilePath() ?? ''))?.rows).toBe(
        1,
      );
    });

    it('detaches an empty recorder without creating a session file', async () => {
      const store = await newStore();
      const rec = recorder();
      await store.attachJournal(rec, true);
      await store.detachJournal(rec);
      store.apply({ kind: 'content', content: row('after stop') });
      await boundary(store);
      expect(store.isRecorder(rec)).toBe(false);
      expect(rec.getFilePath()).toBeNull();
    });

    it('binds the recorder as the mirror of its origin and keeps its session facts', async () => {
      const store = await newStore();
      const rec = recorder();
      rec.recordSessionMetadata('A title');
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('b1'), origin: 'agent-b' });
      store.apply({ kind: 'content', content: row('shared') });
      let attached = 0;

      expect(store.isRecorder(rec)).toBe(false);
      await store.attachJournal(rec, true, () => (attached += 1), 'agent-a');

      expect(attached).toBe(1);
      expect(store.isRecorder(rec)).toBe(true);
      expect(store.primaryOriginId()).toBe('agent-a');
      expect(await texts(rec)).toStrictEqual(['a1', 'shared']);

      store.apply({ kind: 'content', content: row('b2'), origin: 'agent-b' });
      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      await boundary(store);

      expect(await texts(rec)).toStrictEqual(['a1', 'shared', 'a2']);
      const facts = await (
        await rec.session()
      ).store.getState(SESSION_KEYS.title);
      expect(facts).toBeDefined();
      expect(rec.getSessionMetadataTitle()).toBe('A title');
    });

    it('reports a recorder that is already bound as attached and writes nothing', async () => {
      const store = await newStore();
      const rec = recorder();
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      await store.attachJournal(rec, true, undefined, 'agent-a');
      const commitSeq = (await rec.session()).store.published?.commitSeq;
      let attached = 0;

      await store.attachJournal(rec, true, () => (attached += 1), 'agent-a');

      expect(attached).toBe(1);
      expect((await rec.session()).store.published?.commitSeq).toBe(commitSeq);
    });

    it('unbinds the recorder when the attached callback throws', async () => {
      const store = await newStore();
      const rec = recorder();
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });

      await expect(
        store.attachJournal(
          rec,
          true,
          () => {
            throw new Error('subscription refused');
          },
          'agent-a',
        ),
      ).rejects.toThrow('subscription refused');

      expect(store.isRecorder(rec)).toBe(false);
      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      await boundary(store);
      expect(await texts(rec)).toStrictEqual(['a1']);
    });

    it('stops delivering to a detached recorder, and ignores one that was never attached', async () => {
      const store = await newStore();
      const rec = recorder();
      const stranger = recorder(SECOND_SESSION);
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      await store.attachJournal(rec, true, undefined, 'agent-a');

      await store.detachJournal(stranger);
      expect(store.isRecorder(rec)).toBe(true);

      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      await store.detachJournal(rec);
      store.apply({ kind: 'content', content: row('a3'), origin: 'agent-a' });
      await boundary(store);

      expect(store.isRecorder(rec)).toBe(false);
      expect(await texts(rec)).toStrictEqual(['a1', 'a2']);
    });

    it('refuses a recorder that already holds rows unless the attach replaces them', async () => {
      const first = await newStore('first.llxj');
      const original = recorder();
      first.apply({ kind: 'content', content: row('old'), origin: 'agent-a' });
      await first.attachJournal(original, true, undefined, 'agent-a');
      await boundary(first);
      const filePath = original.getFilePath();
      await first.dispose();
      await original.dispose();
      if (filePath === null) throw new Error('the recorder wrote no file');

      const reopened = await JournalRecordingService.open(
        config(FIRST_SESSION),
        filePath,
      );
      recorders.push(reopened);
      const second = await newStore('second.llxj');
      second.apply({ kind: 'content', content: row('new'), origin: 'agent-a' });

      await expect(
        second.attachJournal(reopened, false, undefined, 'agent-a'),
      ).rejects.toThrow('already holds rows');
      expect(second.isRecorder(reopened)).toBe(false);

      await second.attachJournal(reopened, true, undefined, 'agent-a');
      expect(await texts(reopened)).toStrictEqual(['new']);
    });
  });

  describe('durability', () => {
    it('holds the mutation boundary until the recorder file has the group, which waiting for the history alone does not', async () => {
      const failures: { gateWriteAt?: number } = {};
      const seams = testJournalSeams(failures);
      const store = await newStore();
      const rec = recorder(FIRST_SESSION, {
        journal: { journal: seams.dependencies },
      });
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      await store.attachJournal(rec, true, undefined, 'agent-a');
      await boundary(store);
      const filePath = rec.getFilePath();
      if (filePath === null) throw new Error('the recorder wrote no file');
      const committed = async (): Promise<number> => {
        const reader = await openJournalReadOnly(filePath);
        try {
          return reader.trailer?.commitSeq ?? 0;
        } finally {
          await reader.close();
        }
      };
      const before = await committed();
      failures.gateWriteAt = seams.events.filter(
        (event) => event.type === 'write',
      ).length;

      // A failing assertion must still release the gated write, or the cleanup waits on it forever.
      let waiting: Promise<void> | undefined;
      let settled = false;
      try {
        store.apply({
          kind: 'content',
          content: row('a2'),
          origin: 'agent-a',
        });
        await store.waitForDurable();
        expect(await committed()).toBe(before);

        waiting = boundary(store).then(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(settled).toBe(false);
      } finally {
        seams.release();
      }
      await waiting;
      expect(await committed()).toBeGreaterThan(before);
      expect(await texts(rec)).toStrictEqual(['a1', 'a2']);
    });

    it('holds the mutation boundary until the preview write of a recorder has landed', async () => {
      const store = await newStore();
      const rec = recorder();
      await store.attachJournal(rec, true, undefined, 'agent-a');
      await boundary(store);
      // The recorder reports its queue as drained only when the test lets it.
      const drained = rec.flush.bind(rec);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const flushing = spyOn(rec, 'flush').mockImplementation(async () => {
        await drained();
        await gate;
      });

      let waiting: Promise<void> | undefined;
      let settled = false;
      try {
        store.apply({
          kind: 'content',
          content: row('the first question'),
          origin: 'agent-a',
        });
        waiting = boundary(store).then(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(flushing).toHaveBeenCalled();
        expect(settled).toBe(false);
      } finally {
        release();
      }
      await waiting;
      flushing.mockRestore();
      expect(await previewOfFile(rec)).toBe('the first question');
    });

    it('flushes every row and fact queued through the store and the recorder', async () => {
      const store = await newStore();
      const rec = recorder();
      await store.attachJournal(rec, true, undefined, 'agent-a');
      for (let at = 0; at < 100; at += 1) {
        store.apply({
          kind: 'content',
          content: row(`row ${at}`),
          origin: at % 2 === 0 ? 'agent-a' : 'agent-b',
        });
      }
      rec.recordSessionMetadata('Flushed');
      rec.recordProviderSwitch('openai', 'model-2');

      await boundary(store);
      await rec.flush();
      const filePath = rec.getFilePath();
      if (filePath === null) throw new Error('the recorder wrote no file');
      await store.dispose();
      await rec.dispose();

      const reopened = await JournalRecordingService.open(
        config(FIRST_SESSION),
        filePath,
      );
      recorders.push(reopened);
      const held = await texts(reopened);
      expect(held).toHaveLength(50);
      expect(held[0]).toBe('row 0');
      expect(held[49]).toBe('row 98');
      expect(reopened.getSessionMetadataTitle()).toBe('Flushed');
    });
  });

  describe('the session preview of a recorder', () => {
    it('is the first user row the recorder accepts, not the first of the whole history, when it attaches late', async () => {
      const store = await newStore();
      store.apply({
        kind: 'content',
        content: row('b question'),
        origin: 'agent-b',
      });
      store.apply({
        kind: 'content',
        content: row('a question'),
        origin: 'agent-a',
      });
      store.apply({ kind: 'content', content: row('shared question') });
      const recA = recorder(FIRST_SESSION);
      const recB = recorder(SECOND_SESSION);

      await store.attachJournal(recA, true, undefined, 'agent-a');
      await store.attachJournal(recB, true, undefined, 'agent-b');
      await boundary(store);

      expect(await previewOfRecorder(recA)).toBe('a question');
      expect(await previewOfRecorder(recB)).toBe('b question');
    });

    it('is the first user row the recorder accepts when the rows arrive after it is bound', async () => {
      const store = await newStore();
      const recA = recorder(FIRST_SESSION);
      const recB = recorder(SECOND_SESSION);
      await store.attachJournal(recA, true, undefined, 'agent-a');
      await store.attachJournal(recB, true, undefined, 'agent-b');

      store.apply({
        kind: 'content',
        content: row('b first'),
        origin: 'agent-b',
      });
      store.apply({
        kind: 'content',
        content: row('a first'),
        origin: 'agent-a',
      });
      store.apply({
        kind: 'content',
        content: row('b second'),
        origin: 'agent-b',
      });
      await boundary(store);

      expect(await previewOfRecorder(recA)).toBe('a first');
      expect(await previewOfRecorder(recB)).toBe('b first');
    });

    it('counts an unowned user row for every recorder, and a row of another agent for none', async () => {
      const store = await newStore();
      const recA = recorder(FIRST_SESSION);
      const recB = recorder(SECOND_SESSION);
      await store.attachJournal(recA, true, undefined, 'agent-a');
      await store.attachJournal(recB, true, undefined, 'agent-b');

      store.apply({ kind: 'content', content: row('shared question') });
      store.apply({
        kind: 'content',
        content: row('a later'),
        origin: 'agent-a',
      });
      await boundary(store);

      expect(await previewOfRecorder(recA)).toBe('shared question');
      expect(await previewOfRecorder(recB)).toBe('shared question');
    });

    it('is absent for a recorder whose agent has written no user row', async () => {
      const store = await newStore();
      const recB = recorder(SECOND_SESSION);
      await store.attachJournal(recB, true, undefined, 'agent-b');

      store.apply({
        kind: 'content',
        content: row('only a'),
        origin: 'agent-a',
      });
      await boundary(store);

      expect(await previewOfRecorder(recB)).toBeUndefined();
    });
  });
});
