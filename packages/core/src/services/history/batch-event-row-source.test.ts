/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HISTORY_BACKEND_ENV } from './historyBackendSelect.js';
import { HistoryService } from './HistoryService.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import { createUserMessage, type IContent } from './IContent.js';

function textOf(row: IContent): string {
  const block = row.blocks[0];
  return block.type === 'text' ? block.text : '';
}

async function readTexts(source: HistoryBatchRowSource): Promise<string[]> {
  const texts: string[] = [];
  for await (const row of source.rows()) texts.push(textOf(row));
  return texts;
}

/** One listener, written only against the row source, on both stores: the service reads the backend from the environment when it is constructed. */
describe.each(['old', 'journal'] as const)(
  'contentBatchAdded row source (%s store)',
  (backend) => {
    const saved = process.env[HISTORY_BACKEND_ENV];
    const created: HistoryService[] = [];
    beforeEach(() => {
      process.env[HISTORY_BACKEND_ENV] = backend;
    });
    afterEach(async () => {
      if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
      else process.env[HISTORY_BACKEND_ENV] = saved;
      for (const history of created.splice(0)) await history.dispose();
    });

    function service(): HistoryService {
      const history = new HistoryService();
      created.push(history);
      return history;
    }

    it('lets a pass started during dispatch read every published row', async () => {
      const history = service();
      const passes: Array<Promise<string[]>> = [];
      const lengths: number[] = [];
      history.on('contentBatchAdded', (batch) => {
        lengths.push(batch.length);
        passes.push(readTexts(batch));
        passes.push(readTexts(batch));
      });

      await history.addBatch([
        createUserMessage('first'),
        createUserMessage('second'),
        createUserMessage('third'),
      ]);

      expect(lengths).toStrictEqual([3]);
      expect(await Promise.all(passes)).toStrictEqual([
        ['first', 'second', 'third'],
        ['first', 'second', 'third'],
      ]);
    });

    it('refuses a pass that starts after the dispatcher retired the source', async () => {
      const history = service();
      let kept: HistoryBatchRowSource | undefined;
      history.on('contentBatchAdded', (batch) => {
        kept = batch;
      });

      await history.addBatch([createUserMessage('only')]);

      if (kept === undefined) throw new Error('No batch event was emitted');
      await expect(readTexts(kept)).rejects.toThrow(/retired|closed/);
    });

    it('emits nothing when the batch fails', async () => {
      const history = service();
      let events = 0;
      history.on('contentBatchAdded', () => {
        events++;
      });

      await expect(
        history.addBatch([
          createUserMessage('valid first'),
          { speaker: 'ai', blocks: [] },
        ]),
      ).rejects.toThrow('batch entry 1');

      expect(events).toBe(0);
    });

    it('rolls the batch back when the listener throws after starting a pass', async () => {
      const history = service();
      const passes: Array<Promise<string[]>> = [];
      history.on('contentBatchAdded', (batch) => {
        const pass = readTexts(batch);
        pass.catch(() => undefined);
        passes.push(pass);
        throw new Error('listener failed');
      });

      await expect(
        history.addBatch([createUserMessage('first')]),
      ).rejects.toThrow('listener failed');

      const rows: string[] = [];
      for await (const row of history.streamRawHistory())
        rows.push(textOf(row));
      expect(rows).toStrictEqual([]);
      expect(passes).toHaveLength(1);
    });
  },
);

/** The old store's rows live in the publication's own scope, so its dispatcher waits for the passes it was handed. */
describe('contentBatchAdded on the old store', () => {
  const saved = process.env[HISTORY_BACKEND_ENV];
  beforeEach(() => {
    process.env[HISTORY_BACKEND_ENV] = 'old';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
  });

  it('holds the publication until a pass started during dispatch has read its last row', async () => {
    const history = new HistoryService();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    history.on('contentBatchAdded', (batch) => {
      void (async () => {
        for await (const row of batch.rows()) {
          seen.push(textOf(row));
          await gate;
        }
      })();
    });

    let settled = false;
    const added = history
      .addBatch([createUserMessage('first'), createUserMessage('second')])
      .then(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    expect(seen).toStrictEqual(['first']);

    release();
    await added;
    expect(seen).toStrictEqual(['first', 'second']);
    await history.dispose();
  });
});
