/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { statSync } from 'node:fs';
import { getScratchRoot } from '../../storage/scratch-root.js';
import { JournalDensitySpans } from './journalDensitySpans.js';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import type { IContent } from './IContent.js';

async function denyIntervalCreation(
  action: () => Promise<void>,
): Promise<void> {
  getScratchRoot();
  const attempts: string[] = [];
  const denied = (path: unknown): never => {
    attempts.push(String(path));
    throw new Error('Native density must not create interval files');
  };
  const open = fs.openSync;
  const asyncOpen = promises.open;
  const directories = spyOn(fs, 'mkdtempSync').mockImplementation(denied);
  const asyncDirectories = spyOn(promises, 'mkdtemp').mockImplementation(
    async (path) => denied(path),
  );
  const files = spyOn(fs, 'openSync').mockImplementation(
    (path, flags, mode) => {
      if (
        typeof flags === 'number'
          ? (flags & fs.constants.O_CREAT) !== 0
          : typeof flags === 'string' && /[wa]/.test(flags)
      )
        return denied(path);
      return open(path, flags, mode);
    },
  );
  const asyncFiles = spyOn(promises, 'open').mockImplementation(
    async (path, flags, mode) => {
      if (
        typeof flags === 'number'
          ? (flags & fs.constants.O_CREAT) !== 0
          : typeof flags === 'string' && /[wa]/.test(flags)
      )
        return denied(path);
      return asyncOpen(path, flags, mode);
    },
  );
  let failure: { error: unknown } | undefined;
  try {
    await action();
  } catch (error) {
    failure = { error };
  } finally {
    directories.mockRestore();
    asyncDirectories.mockRestore();
    files.mockRestore();
    asyncFiles.mockRestore();
  }
  expect(attempts).toStrictEqual([]);
  if (failure !== undefined) throw failure.error;
}

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `value ${index}` }],
    metadata: {
      chronology: {
        seq: index * 3 + 1,
        userTurn: 1,
        step: index,
        recordedAt: 0,
      },
    },
  };
}

function spanHost(
  host: DetachedHistoryHost,
  initial: readonly RemovedInteriorSpan[],
): {
  host: DetachedHistoryHost;
  spans(): readonly RemovedInteriorSpan[];
} {
  let spans = initial;
  return {
    host: {
      ...host,
      snapshot: () => ({ ...host.snapshot(), spans }),
      apply: (tokens, next) => {
        host.apply(tokens, next);
        spans = next;
      },
    },
    spans: () => spans,
  };
}

describe('native detached density annotation projection', () => {
  const directory = useTempDir('native-density-spans-');

  for (const size of [3, 64, 65, 1025, 5000])
    it(`matches the array overlap and stable reason oracle for ${size} unordered source positions`, async () => {
      const journal = await openOwnedJournal(
        join(directory(), 'primary.llxj'),
        Array.from({ length: size }, (_, index) => ({
          content: row(index),
          origin: index % 2 === 0 ? 'a' : 'b',
        })),
      );
      const initial: RemovedInteriorSpan[] = [
        { start: 0, end: 4, reason: 'cleared' },
      ];
      const observed = spanHost(journal.host, initial);
      const removed = Array.from({ length: size }, (_, index) => ({
        start: index * 3 + 1,
        end: index * 3 + 1,
        reason: 'density-removed' as const,
      }));
      const replaced = Array.from({ length: size }, (_, index) => ({
        start: index * 3 + 1,
        end: index * 3 + 1,
        reason: 'density-replaced' as const,
      }));
      // Keep automatic named-file compaction outside the interval-file trap.
      const pin = await journal.session.store.snapshot();
      try {
        await denyIntervalCreation(() =>
          journal.store.publishDetached(
            {
              transform: async (_source, sink) => {
                for (let index = size - 1; index >= 0; index--) {
                  await sink.appendReplacement(index, row(index));
                  await sink.removeValue(index);
                }
              },
            },
            observed.host,
            undefined,
            {},
          ),
        );
        expect(observed.spans()).toStrictEqual(
          mergeRemovedInteriorSpans([
            ...initial,
            ...removed,
            ...replaced,
          ]).slice(-SPAN_WINDOW_CAPACITY),
        );
        expect(await journal.originsOfRows()).toStrictEqual(
          Array.from({ length: size }, (_, index) =>
            (size - 1 - index) % 2 === 0 ? 'a' : 'b',
          ),
        );
        expect(
          (await journal.store.materialize()).map((content) => content.blocks),
        ).toStrictEqual(
          Array.from(
            { length: size },
            (_, index) => row(size - index - 1).blocks,
          ),
        );
      } finally {
        await pin.close();
        await journal.dispose();
      }
    });

  it('writes nothing for repeated metadata-only annotations of identical rows', async () => {
    const journal = await openOwnedJournal(join(directory(), 'primary.llxj'), [
      { content: row(0), origin: 'a' },
    ]);
    const observed = spanHost(journal.host, []);
    const edit = async (): Promise<void> =>
      journal.store.publishDetached(
        {
          transform: async (source, sink) => {
            for await (const content of source.streamRows())
              await sink.appendReplacement(0, content);
          },
        },
        observed.host,
        undefined,
        {},
      );
    try {
      const firstCommit = journal.session.store.published?.commitSeq ?? 0;
      const old = await journal.session.store.snapshot();
      const prior = old.version;
      await denyIntervalCreation(edit);
      expect(journal.session.store.published?.commitSeq).toBe(firstCommit + 1);
      expect(journal.session.store.published?.roots.rowRoot).toBe(
        prior?.roots.rowRoot,
      );
      expect((await old.readRow(await old.entryAt(0))).blocks.length).toBe(1);
      await old.close();
      expect(observed.spans()).toStrictEqual([
        { start: 1, end: 1, reason: 'density-replaced' },
      ]);
      expect(
        await journal.session.store.getMeta('history:density-spans:1'),
      ).toBeDefined();
      const bytes = statSync(journal.session.path).size;
      const commit = journal.session.store.published?.commitSeq;
      await denyIntervalCreation(edit);
      expect(statSync(journal.session.path).size - bytes).toBe(0);
      expect(
        (journal.session.store.published?.commitSeq ?? 0) - (commit ?? 0),
      ).toBe(0);
      expect(await journal.originsOfRows()).toStrictEqual(['a']);
    } finally {
      await journal.dispose();
    }
  });

  for (const stage of ['producer', 'projection'])
    it(`keeps the prior version and original cause after ${stage} failure with private span records`, async () => {
      const journal = await openOwnedJournal(
        join(directory(), 'failure.llxj'),
        [{ content: row(0), origin: 'prior' }],
      );
      const observed = spanHost(journal.host, []);
      const failure = new Error(`failed ${stage}`);
      const cleanup = new Error('task cleanup failed');
      const bytes = statSync(journal.session.path).size;
      const sequence = journal.session.store.published?.commitSeq ?? 0;
      const projection = spyOn(JournalDensitySpans.prototype, 'project');
      try {
        if (stage === 'projection') projection.mockRejectedValue(failure);
        const result = journal.store.publishDetached(
          {
            transform: async (_source, sink) => {
              for (let index = 0; index < 1025; index++)
                await sink.removeValue(0);
              await sink.appendReplacement(0, row(1));
              if (stage === 'producer') throw failure;
            },
            dispose: () => {
              throw cleanup;
            },
          },
          observed.host,
          undefined,
          {},
        );
        await expect(result).rejects.toMatchObject({
          cause: failure,
          errors: [failure, cleanup],
        });
        expect(statSync(journal.session.path).size - bytes).toBe(0);
        expect(
          (journal.session.store.published?.commitSeq ?? 0) - sequence,
        ).toBe(0);
        expect(observed.spans()).toStrictEqual([]);
        expect((await journal.store.materialize())[0].blocks).toStrictEqual(
          row(0).blocks,
        );
        expect(await journal.originsOfRows()).toStrictEqual(['prior']);
      } finally {
        projection.mockRestore();
      }
      try {
        await journal.store.publishDetached(
          {
            transform: async (_source, sink) => {
              await sink.appendReplacement(0, row(2));
            },
          },
          observed.host,
          undefined,
          {},
        );
        expect((await journal.store.materialize())[0].blocks).toStrictEqual(
          row(2).blocks,
        );
        expect(await journal.originsOfRows()).toStrictEqual(['prior']);
      } finally {
        await journal.dispose();
      }
    });
});
