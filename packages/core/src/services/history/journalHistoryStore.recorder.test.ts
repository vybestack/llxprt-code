/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { JournalRecordingConfig } from '../../recording/journalRecordingService.js';
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
});
