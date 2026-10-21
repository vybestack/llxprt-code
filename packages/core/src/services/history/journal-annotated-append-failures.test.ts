/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { JournalWriterPoisonedError } from '../../journal/errors.js';
import { JournalSession } from './journalSession.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { HistoryService } from './HistoryService.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: {
      chronology: { seq: 0, userTurn: 1, step: 0, recordedAt: 0 },
    },
  };
}

async function values(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const content of history.streamRawHistory()) rows.push(content);
  return rows;
}

describe('annotated append failure boundaries', () => {
  const directory = useTempDir('annotated-append-failures-');

  it.each(['producer', 'acknowledged', 'abort'])(
    'compensates an earlier four-MiB append batch and the annotated tail on %s failure',
    async (stage) => {
      const history = new HistoryService({ backend: 'journal' });
      history.setTokenizerFactory(exactTokenizer());
      const controller = new AbortController();
      const failure = new Error(`partial ${stage}`);
      const origin = {};
      try {
        await history.detachedValues.append([row('prior')]);
        const host = history.detachedValues.host();
        const before = { rows: await values(history), state: host.snapshot() };
        await history.detachedValues.withCheckpoint(async (checkpoint) => {
          await expect(
            host.journal.publishDetached(
              {
                append: true,
                transform: async (_source, sink) => {
                  for (let index = 0; index < 64; index++)
                    await sink.appendValue(row('x'.repeat(70_000)));
                  for (let index = 0; index < 1025; index++)
                    await sink.removeValue(0);
                  await sink.appendDerived(0, row('row 65'));
                  if (stage === 'producer') throw failure;
                  if (stage === 'abort') controller.abort(failure);
                },
              },
              host,
              undefined,
              {
                origin,
                signal: controller.signal,
                onAcknowledged: () => {
                  if (stage === 'acknowledged') throw failure;
                },
              },
            ),
          ).rejects.toBe(failure);
          expect(await values(history)).toStrictEqual(before.rows);
          expect(host.snapshot()).toStrictEqual(before.state);
          const pinned: IContent[] = [];
          for await (const content of checkpoint) pinned.push(content);
          expect(pinned).toStrictEqual(before.rows);
        });
        await host.journal.publishDetached(
          {
            append: true,
            transform: async (_source, sink) => {
              await sink.removeValue(0);
              await sink.appendValue(row('continued'));
            },
          },
          host,
          undefined,
          { origin },
        );
        expect(
          (await values(history)).map((content) => content.blocks),
        ).toStrictEqual([row('prior').blocks, row('continued').blocks]);
      } finally {
        await history.dispose();
      }
    },
    180_000,
  );

  it.each(['write', 'flush'])(
    'keeps a physical annotated append %s failure poisoned',
    async (stage) => {
      const failures: Failures = {};
      const seams = testJournalSeams(failures);
      const session = await JournalSession.create(
        join(directory(), 'physical.llxj'),
        { journal: seams.dependencies },
      );
      const store = new JournalHistoryStore(session);
      const history = new HistoryService({ backend: 'journal' });
      history.setTokenizerFactory(exactTokenizer());
      const host = { ...history.detachedValues.host(), journal: store };
      try {
        store.apply({ kind: 'content', content: row('prior') });
        await store.waitForDurable();
        if (stage === 'write')
          failures.failWriteAt = seams.events.filter(
            (event) => event.type === 'write',
          ).length;
        else
          failures.failFlushAt = seams.events.filter(
            (event) => event.type === 'flush',
          ).length;
        await expect(
          store.publishDetached(
            {
              append: true,
              transform: async (_source, sink) => {
                await sink.removeValue(0);
                await sink.appendDerived(0, row('new'));
              },
            },
            host,
            undefined,
            {},
          ),
        ).rejects.toThrow(`injected ${stage} failure`);
        await expect(
          store.publishDetached(
            {
              append: true,
              transform: async (_source, sink) => {
                await sink.appendValue(row('after'));
              },
            },
            host,
            undefined,
            {},
          ),
        ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
      } finally {
        await store.dispose();
        await history.dispose();
      }
    },
    180_000,
  );
});
