/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';

import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function textRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function texts(history: HistoryService): Promise<string[]> {
  const out: string[] = [];
  for await (const row of history.streamRawHistory())
    out.push(row.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''));
  return out;
}

/** Builds services on one backend: the service reads the backend from the environment when it is constructed. */
describe.each(['old', 'journal'] as const)(
  'a clear in the history mutation queue (%s store)',
  (backend) => {
    const created: HistoryService[] = [];

    afterEach(async () => {
      for (const history of created.splice(0)) await history.dispose();
    });

    function service(): HistoryService {
      const history = new HistoryService();
      created.push(history);
      return history;
    }

    it('keeps a row added right after clear(), whatever the store does after the call returns', async () => {
      const history = service();
      history.add(textRow('one'));
      history.add(textRow('two'));
      await history.waitForCommit();

      const cleared = history.clear();
      history.add(textRow('after'));
      await cleared;
      await history.waitForCommit();

      expect(await texts(history)).toStrictEqual(['after']);
    });

    it('applies a clear queued during compression before the rows queued after it', async () => {
      const history = service();
      history.add(textRow('one'));
      await history.waitForCommit();
      history.startCompression();
      const cleared = history.clear();
      history.add(textRow('queued after'));

      history.endCompression();
      await cleared;
      await history.waitForCommit();

      expect(await texts(history)).toStrictEqual(['queued after']);
    });

    /** What `endCompression()` throws: the old store's synchronous flush reports a failed clear itself (#2852). */
    function flushError(history: HistoryService): unknown {
      try {
        history.endCompression();
        return undefined;
      } catch (error) {
        return error;
      }
    }

    function settledWith(promise: Promise<void>): Promise<unknown> {
      return promise.then(
        () => undefined,
        (error: unknown) => error,
      );
    }

    /** A history with `rows` committed rows whose next token update throws `failure`, compressing, with a clear queued. */
    async function withFailingQueuedClear(
      rows: string[],
      failure: Error,
    ): Promise<{ history: HistoryService; cleared: Promise<unknown> }> {
      const history = service();
      for (const text of rows) history.add(textRow(text));
      await history.waitForCommit();
      history.once('tokensUpdated', () => {
        throw failure;
      });
      history.startCompression();
      return { history, cleared: settledWith(history.clear()) };
    }

    it('rejects the clear promise when a queued clear fails and puts the rows back', async () => {
      const failure = new Error('clear observer failed');
      const { history, cleared } = await withFailingQueuedClear(
        ['one', 'two'],
        failure,
      );

      const flushed = flushError(history);

      expect(flushed).toBe(backend === 'old' ? failure : undefined);
      expect(await cleared).toBe(failure);
      await settledWith(history.waitForCommit());
      expect(await texts(history)).toStrictEqual(['one', 'two']);
    });

    it('reports a failed queued clear through waitForPendingOperations once', async () => {
      const failure = new Error('clear observer failed');
      const { history, cleared } = await withFailingQueuedClear(
        ['one'],
        failure,
      );
      flushError(history);
      await cleared;

      const first = await settledWith(history.waitForPendingOperations());
      const second = await settledWith(history.waitForPendingOperations());

      expect(first).toBe(backend === 'journal' ? failure : undefined);
      expect(second).toBeUndefined();
    });

    it('reports a failed queued clear through waitForCommit once', async () => {
      const failure = new Error('clear observer failed');
      const { history, cleared } = await withFailingQueuedClear(
        ['one'],
        failure,
      );
      flushError(history);
      await cleared;

      const first = await settledWith(history.waitForCommit());
      const second = await settledWith(history.waitForCommit());

      expect(first).toBe(backend === 'journal' ? failure : undefined);
      expect(second).toBeUndefined();
    });

    it('does not report a clear that succeeded', async () => {
      const history = service();
      history.add(textRow('one'));
      history.startCompression();
      const cleared = history.clear();
      history.endCompression();
      await cleared;

      await history.waitForPendingOperations();
      await history.waitForCommit();
      expect(await texts(history)).toStrictEqual([]);
    });
  },
);
