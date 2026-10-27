/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { getScratchRoot } from '../../storage/scratch-root.js';
import type { DetachedHistoryTransform } from './detachedHistoryMutation.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import type { IContent } from './IContent.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';

async function notifyRows(
  rows: HistoryBatchRowSource,
  failure?: Error,
): Promise<void> {
  try {
    if (failure !== undefined) throw failure;
  } finally {
    await rows.retire();
  }
}

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function withoutCandidateFiles(
  action: () => Promise<void>,
): Promise<void> {
  getScratchRoot();
  const syncDirectories = spyOn(fs, 'mkdtempSync');
  const asyncDirectories = spyOn(promises, 'mkdtemp');
  const syncFiles = spyOn(fs, 'openSync');
  const asyncFiles = spyOn(promises, 'open');
  try {
    await action();
    const creates = (flags: string | number | undefined): boolean =>
      typeof flags === 'number'
        ? (flags & fs.constants.O_CREAT) !== 0
        : typeof flags === 'string' && /[wa]/.test(flags);
    expect({
      syncDirectories: syncDirectories.mock.calls.map(([path]) => String(path)),
      asyncDirectories: asyncDirectories.mock.calls.map(([path]) =>
        String(path),
      ),
      syncFiles: syncFiles.mock.calls
        .filter(([, flags]) => creates(flags))
        .map(([path]) => String(path)),
      asyncFiles: asyncFiles.mock.calls
        .filter(([, flags]) => creates(flags))
        .map(([path]) => String(path)),
    }).toStrictEqual({
      syncDirectories: [],
      asyncDirectories: [],
      syncFiles: [],
      asyncFiles: [],
    });
  } finally {
    syncDirectories.mockRestore();
    asyncDirectories.mockRestore();
    syncFiles.mockRestore();
    asyncFiles.mockRestore();
  }
}

const copy: DetachedHistoryTransform = async (source, sink) => {
  let ordinal = 0;
  for await (const content of source.streamRows())
    await sink.appendDerived(ordinal++, { ...content });
};

const replacements: ReadonlyArray<{
  readonly name: string;
  readonly transform: DetachedHistoryTransform;
  readonly expected: readonly string[];
  readonly owners: ReadonlyArray<string | undefined>;
  readonly commits: number;
}> = [
  {
    name: 'identical copied prefix',
    transform: copy,
    expected: ['a', 'b', 'c'],
    owners: ['first', 'second', 'third'],
    commits: 0,
  },
  {
    name: 'shorter prefix',
    transform: async (source, sink) => {
      for await (const content of source.streamRows()) {
        await sink.appendDerived(0, content);
        break;
      }
    },
    expected: ['a'],
    owners: ['first'],
    commits: 1,
  },
  {
    name: 'empty replacement',
    transform: async () => {},
    expected: [],
    owners: [],
    commits: 1,
  },
  {
    name: 'diverging replacement after a copied prefix',
    transform: async (source, sink) => {
      for await (const content of source.streamRows()) {
        await sink.appendDerived(0, { ...content });
        break;
      }
      await sink.appendValue(row('replacement'));
    },
    expected: ['a', 'replacement'],
    owners: ['first', undefined],
    commits: 1,
  },
  {
    name: 'compression summary and owned tail',
    transform: async (source, sink) => {
      await sink.appendValue({
        ...row('summary'),
        metadata: {
          isSummary: true,
          chronologyReplaced: { fromSeq: 1, toSeq: 2, itemCount: 2 },
        },
      });
      let ordinal = 0;
      for await (const content of source.streamRows()) {
        if (ordinal === 2) await sink.appendDerived(ordinal, { ...content });
        ordinal++;
      }
    },
    expected: ['summary', 'c'],
    owners: [undefined, 'third'],
    commits: 1,
  },
];

describe('native detached publication without candidate files', () => {
  const directory = useTempDir('journal-no-candidate-files-');
  for (const { name, transform, expected, owners, commits } of replacements)
    it(`publishes ${name} without creating operation files`, async () => {
      const journal = await openOwnedJournal(
        join(directory(), 'primary.llxj'),
        [
          { content: row('a'), origin: 'first' },
          { content: row('b'), origin: 'second' },
          { content: row('c'), origin: 'third' },
        ],
      );
      try {
        const before = journal.session.store.published?.commitSeq ?? 0;
        const bytes = fs.statSync(journal.session.path).size;
        await withoutCandidateFiles(async () => {
          await journal.store.publishDetached(
            { transform },
            journal.host,
            undefined,
            {},
          );
        });
        expect(
          (await journal.store.materialize()).flatMap((content) =>
            content.blocks.flatMap((block) =>
              block.type === 'text' ? [block.text] : [],
            ),
          ),
        ).toStrictEqual([...expected]);
        expect(journal.session.store.published?.commitSeq).toBe(
          before + commits,
        );
        const publishedBytes = fs.statSync(journal.session.path).size;
        expect(publishedBytes).toBeGreaterThanOrEqual(bytes);
        expect(publishedBytes > bytes).toBe(commits > 0);
        expect(await journal.originsOfRows()).toStrictEqual([...owners]);
      } finally {
        await journal.dispose();
      }
    });

  for (const stage of ['producer', 'acknowledged', 'cancelled', 'listener'])
    it(`restores the pinned version after ${stage} failure and continues without candidate files`, async () => {
      const journal = await openOwnedJournal(
        join(directory(), 'primary.llxj'),
        [{ content: row('original'), origin: 'original-owner' }],
      );
      const failure = new Error(`failed ${stage}`);
      const controller = new AbortController();
      try {
        await withoutCandidateFiles(async () => {
          await expect(
            journal.store.publishDetached(
              {
                transform: async (_source, sink) => {
                  await sink.appendValue(row('rejected'));
                  if (stage === 'producer') throw failure;
                  if (stage === 'cancelled') controller.abort(failure);
                },
              },
              {
                ...journal.host,
                notifyRows: (rows) =>
                  notifyRows(rows, stage === 'listener' ? failure : undefined),
              },
              undefined,
              {
                publishBatch: true,
                signal: controller.signal,
                onAcknowledged: () => {
                  if (stage === 'acknowledged') throw failure;
                },
              },
            ),
          ).rejects.toBe(failure);
          expect(await journal.originsOfRows()).toStrictEqual([
            'original-owner',
          ]);
          const contents = await journal.store.materialize();
          expect(contents[0].blocks).toStrictEqual([
            { type: 'text', text: 'original' },
          ]);
          await journal.store.publishDetached(
            {
              append: true,
              transform: async (_source, sink) => {
                await sink.appendValue(row('accepted'));
              },
            },
            journal.host,
            undefined,
            {},
          );
        });
        expect(journal.store.getLength()).toBe(2);
        expect(journal.session.store.mediaPins.oldestVersion).toBeUndefined();
        expect(await journal.originsOfRows()).toStrictEqual([
          'original-owner',
          undefined,
        ]);
      } finally {
        await journal.dispose();
      }
    });
});
