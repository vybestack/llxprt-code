/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * The exposed scalar length must follow logical membership. While a replace
 * transaction is open every reader hides its tagged rows, so the length, the
 * cursor row count, the streamed rows and the replayed journal must all keep
 * the prior rows at every admission and acknowledgement boundary. Commit
 * makes the transaction's rows the membership; abort, an abandoning record or
 * a recorder that refuses the compensation leave the prior rows.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JournalResolver } from '../../recording/journalResolver.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { SessionEventType } from '../../recording/types.js';
import type { SessionRecordLine } from '../../recording/types.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import {
  durableRowsOf,
  exactTokenizer,
  expectedRange,
  rejectedValue,
  rollbackRow,
  rowsOf,
} from './chronology-rollback-test-helpers.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

function textOf(content: IContent): string {
  const block = content.blocks[0];
  if (block.type !== 'text') throw new Error('expected a text block');
  return block.text;
}

/** Refuses every admission after the allowed number, and keeps refusing. */
class PoisonableRecorder extends SessionRecordingService {
  private remaining: number | undefined;
  readonly failure = new Error('injected poisoned recorder');

  poisonAfter(admissions: number): void {
    this.remaining = admissions;
  }

  override enqueue(
    type: SessionEventType,
    payload: unknown,
  ): SessionRecordLine | null {
    if (this.remaining === 0) throw this.failure;
    if (this.remaining !== undefined) this.remaining--;
    return super.enqueue(type, payload);
  }
}

function newRecorder(root: string): PoisonableRecorder {
  return new PoisonableRecorder({
    sessionId: 'scalar-tx',
    projectHash: 'scalar-tx',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
}

async function withStore(
  action: (
    store: HistoryJournalStore,
    recorder: PoisonableRecorder,
  ) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scalar-tx-'));
  const recorder = newRecorder(root);
  const store = new HistoryJournalStore(recorder);
  try {
    await action(store, recorder);
  } finally {
    store.dispose();
    await recorder.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function replayedTexts(
  recorder: SessionRecordingService,
): Promise<string[]> {
  await recorder.flush();
  const file = recorder.getFilePath();
  if (file === null) throw new Error('journal was not materialized');
  const resolver = await JournalResolver.open(file);
  try {
    const texts: string[] = [];
    for await (const entry of resolver.resolve())
      texts.push(textOf(entry.content));
    return texts;
  } finally {
    await resolver.close();
  }
}

async function streamedTexts(store: HistoryJournalStore): Promise<string[]> {
  const texts: string[] = [];
  for await (const content of store.streamRows()) texts.push(textOf(content));
  return texts;
}

/** Every membership view of the store must show exactly `expected`. */
async function expectMembership(
  store: HistoryJournalStore,
  expected: readonly string[],
): Promise<void> {
  expect(store.getLength()).toBe(expected.length);
  const cursor = store.withReadRows((view) => ({
    length: view.length,
    texts: [...view.rows()].map(textOf),
  }));
  expect(cursor.length).toBe(expected.length);
  expect(cursor.texts).toStrictEqual([...expected]);
  expect(store.materialize().map(textOf)).toStrictEqual([...expected]);
  expect(await streamedTexts(store)).toStrictEqual([...expected]);
}

/** Boundary check before and after the acknowledgement of everything admitted. */
async function expectAtBothBoundaries(
  store: HistoryJournalStore,
  recorder: SessionRecordingService,
  expected: readonly string[],
): Promise<void> {
  await expectMembership(store, expected);
  await store.waitForDurable();
  await expectMembership(store, expected);
  expect(await replayedTexts(recorder)).toStrictEqual([...expected]);
}

const OLD = ['old-0', 'old-1', 'old-2'];
const NEW = ['new-0', 'new-1', 'new-2', 'new-3'];

function seed(store: HistoryJournalStore): void {
  for (const text of OLD) store.apply({ kind: 'content', content: row(text) });
}

describe('scalar length follows replace-transaction membership', () => {
  it('keeps the prior length for an admitted tagged row, before and after its acknowledgement', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      await store.waitForDurable();
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      await expectAtBothBoundaries(store, recorder, OLD);
      expect(store.getLength()).toBe(3);
    });
  });

  it('holds the prior membership at begin and after each row, then adopts the commit', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      await expectAtBothBoundaries(store, recorder, OLD);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      await expectAtBothBoundaries(store, recorder, OLD);
      for (const text of NEW) {
        store.apply({ kind: 'content', content: row(text), tx: 'tx-1' });
        await expectMembership(store, OLD);
        await store.waitForDurable();
        await expectMembership(store, OLD);
        expect(await replayedTexts(recorder)).toStrictEqual(OLD);
      }
      store.apply({
        kind: 'replaceCommit',
        txId: 'tx-1',
        rowCount: NEW.length,
      });
      await expectAtBothBoundaries(store, recorder, NEW);
    });
  });

  it('commits an empty transaction to an empty history', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      await expectMembership(store, OLD);
      store.apply({ kind: 'replaceCommit', txId: 'tx-1', rowCount: 0 });
      await expectAtBothBoundaries(store, recorder, []);
      expect(store.getLength()).toBe(0);
    });
  });

  it('returns to the prior rows on abort and keeps counting from them', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-1'), tx: 'tx-1' });
      store.apply({ kind: 'replaceAbort', txId: 'tx-1', rowCount: 2 });
      await expectAtBothBoundaries(store, recorder, OLD);
      store.apply({ kind: 'content', content: row('after') });
      await expectAtBothBoundaries(store, recorder, [...OLD, 'after']);
      expect(store.getLength()).toBe(4);
    });
  });

  it('drops an abandoned transaction when an ordinary row follows', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-1'), tx: 'tx-1' });
      await expectMembership(store, OLD);
      store.apply({ kind: 'content', content: row('resumed') });
      await expectAtBothBoundaries(store, recorder, [...OLD, 'resumed']);
      expect(store.getLength()).toBe(4);
    });
  });

  it('counts a count-only rewind from the prior rows when it abandons a transaction', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-1'), tx: 'tx-1' });
      store.apply({ kind: 'rewind', itemsRemoved: 1 });
      await expectAtBothBoundaries(store, recorder, OLD.slice(0, 2));
      expect(store.getLength()).toBe(2);
    });
  });

  it('keeps the prior membership when the recorder refuses the abort', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      await store.waitForDurable();
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      recorder.poisonAfter(0);
      expect(() =>
        store.apply({ kind: 'replaceAbort', txId: 'tx-1', rowCount: 1 }),
      ).toThrow(recorder.failure);
      await expectAtBothBoundaries(store, recorder, OLD);
    });
  });

  it('keeps the prior membership when the recorder refuses a row mid-transaction', async () => {
    await withStore(async (store, recorder) => {
      seed(store);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      recorder.poisonAfter(0);
      expect(() =>
        store.apply({ kind: 'content', content: row('new-1'), tx: 'tx-1' }),
      ).toThrow(recorder.failure);
      await expectAtBothBoundaries(store, recorder, OLD);
    });
  });

  it('shows no provisional rows as pending cardinality in an open transaction', async () => {
    await withStore(async (store) => {
      seed(store);
      store.apply({ kind: 'replaceBegin', txId: 'tx-1' });
      store.apply({ kind: 'content', content: row('new-0'), tx: 'tx-1' });
      const pending = store.withReadRows((view) => {
        let count = 0;
        for (let index = 0; index < view.length; index++)
          if (view.isPendingRow(index)) count++;
        return count;
      });
      expect(pending).toBe(store.getLength());
      await store.waitForDurable();
      const settled = store.withReadRows((view) => {
        let count = 0;
        for (let index = 0; index < view.length; index++)
          if (view.isPendingRow(index)) count++;
        return count;
      });
      expect(settled).toBe(0);
    });
  });
});

describe('HistoryService scalars follow a replacement that cannot finish', () => {
  // Admissions of a 3-row replacement: begin, three rows, commit.
  for (const admissions of [0, 1, 2, 3, 4]) {
    it(`keeps length, tokens, range, chronology and replay on the prior rows when the recorder is poisoned after ${admissions} admissions`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scalar-tx-svc-'));
      const recorder = newRecorder(root);
      const history = new HistoryService({ recording: recorder });
      history.setTokenizerFactory(exactTokenizer());
      try {
        const before = [rollbackRow(0), rollbackRow(1)];
        for (const content of before) history.add(content);
        await history.waitForCommit();
        recorder.poisonAfter(admissions);
        const replacement = [rollbackRow(2), rollbackRow(3), rollbackRow(4)];
        const failure = await rejectedValue(history.replaceBatch(replacement));
        // Once something was admitted the refused compensation is reported
        // together with the primary failure.
        const reported =
          failure instanceof AggregateError ? failure.errors : [failure];
        expect(reported).toContain(recorder.failure);
        const rows = await rowsOf(history);
        expect(rows).toHaveLength(2);
        expect(history.length()).toBe(2);
        expect(history.isEmpty()).toBe(false);
        expect(history.getTotalTokens()).toBe(8);
        expect(history.getContextRange()).toStrictEqual(expectedRange(2));
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual(rows);
      } finally {
        history.dispose();
        await recorder.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
