/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { MUTATION } from '../../journal/recordKinds.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';
import { createSessionRecorder } from '../../recording/sessionRecorderFactory.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { historyOriginId } from './historyOriginId.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { JournalSession } from './journalSession.js';

async function assertCopiedOwners(
  current: VersionSnapshot,
  prior: VersionSnapshot,
  size: number,
): Promise<void> {
  for (let index = 0; index < size; index++) {
    expect(await current.entryAt(index)).toStrictEqual(
      await prior.entryAt(index),
    );
    expect((await current.entryAt(size + 1 + index)).owner).toBe(
      (await prior.entryAt(index)).owner,
    );
  }
}

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `annotated ${index}` }],
    metadata: {
      chronology: {
        seq: index * 4,
        userTurn: index + 1,
        step: 1,
        recordedAt: 0,
      },
    },
  };
}

async function contents(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const content of history.streamRawHistory()) rows.push(content);
  return rows;
}

async function durable(recorder: SessionRecordingPort): Promise<IContent[]> {
  const file = recorder.getFilePath();
  if (file === null) throw new Error('Missing annotated append recording');
  const journal = await JournalSession.open(file);
  try {
    const rows: IContent[] = [];
    for await (const entry of journal.rows()) rows.push(entry.content);
    return rows;
  } finally {
    await journal.close();
  }
}

async function capture(root: string, size: number): Promise<unknown> {
  const history = new HistoryService({});
  history.setTokenizerFactory(exactTokenizer());
  const mirrors = [0, 1].map((index) =>
    createSessionRecorder({
      sessionId: `journal-${size}-${index}`,
      projectHash: 'annotated-append',
      chatsDir: root,
      workspaceDirs: [root],
      provider: 'test',
      model: 'test',
    }),
  );
  try {
    await history.detachedValues.append(
      Array.from({ length: size }, (_, index) => row(index)),
    );
    for (const mirror of mirrors)
      await history.attachJournal(mirror, true, undefined, {});
    await appendAnnotations(history, size);
    await history.waitForCommit();
    const rows = await contents(history);
    expect(rows.length).toBe(size * 2 + 1);
    for (const mirror of mirrors)
      expect(await durable(mirror)).toStrictEqual(rows);
    const state = {
      rows,
      tokens: history.getTotalTokens(),
      range: history.getContextRange(),
      offset: history.getBaseTokenOffset(),
    };
    await history.clear();
    await history.waitForCommit();
    expect(await contents(history)).toStrictEqual([]);
    for (const mirror of mirrors)
      expect(await durable(mirror)).toStrictEqual([]);
    return state;
  } finally {
    await history.dispose();
    for (const mirror of mirrors) await mirror.dispose();
  }
}

async function appendAnnotations(
  history: HistoryService,
  size: number,
): Promise<void> {
  const host = history.detachedValues.host();
  await host.journal.publishDetached(
    {
      append: true,
      transform: async (_source, sink) => {
        for (let index = size - 1; index >= 0; index--) {
          const ordinal = (index * 17) % size;
          await sink.appendReplacement(ordinal, row(ordinal + size));
          await sink.removeValue(ordinal);
        }
        await sink.appendValue({
          ...row(size * 2),
          metadata: {
            ...row(size * 2).metadata,
            isSummary: true,
            chronologyReplaced: { fromSeq: 1, toSeq: 2, itemCount: 2 },
          },
        });
      },
    },
    host,
    undefined,
    {},
  );
}

function expectedState(size: number): unknown {
  const originals = Array.from({ length: size }, (_, index) => row(index));
  const replacements = Array.from({ length: size }, (_, index) => {
    const ordinal = ((size - 1 - index) * 17) % size;
    return {
      ...row(ordinal + size),
      metadata: originals[ordinal].metadata,
    };
  });
  const summary = {
    ...row(size * 2),
    metadata: {
      ...row(size * 2).metadata,
      isSummary: true,
      chronologyReplaced: { fromSeq: 1, toSeq: 2, itemCount: 2 },
    },
  };
  return {
    rows: [...originals, ...replacements, summary],
    tokens: size * 2 + 1,
    offset: 0,
    range: {
      firstSeq: 0,
      lastSeq: size * 8,
      totalEntries: size * 2 + 1,
      removedInterior: [
        ...Array.from({ length: size }, (_, index) => ({
          start: index * 4,
          end: index * 4,
          reason: 'density-removed',
        })).slice(-SPAN_WINDOW_CAPACITY),
        { start: 1, end: 2, reason: 'compressed' },
      ].sort((left, right) => left.start - right.start),
      approximate: false,
    },
  };
}

describe('annotated append independent values, tokens, mirrors and owners', () => {
  const directory = useTempDir('native-annotated-parity-');

  it.each([512, 8192])(
    'preserves all %i annotated duplicate chronology rows in both native mirrors and clears them',
    async (size) => {
      expect(await capture(directory(), size)).toStrictEqual(
        expectedState(size),
      );
    },
    180_000,
  );

  it.each([3, 64, 65, 5000])(
    'preserves labels and current source owners after a prefix cut and %i annotated derived appends',
    async (size) => {
      const owners = ['a', 'b', undefined];
      const journal = await openOwnedJournal(
        join(directory(), 'owners.llxj'),
        [],
      );
      const origin = {};
      try {
        await journal.store.replaceFrom(
          Array.from({ length: size + 2 }, (_, index) => row(index)),
          size + 2,
        );
        journal.store.changeOwnersOf(
          Array.from({ length: size + 2 }, (_, position) => ({
            position,
            origin: owners[position % owners.length],
          })),
        );
        await journal.store.waitForDurable();
        await journal.store.publishDetached(
          {
            transform: async (source, sink) => {
              let ordinal = 0;
              for await (const content of source.streamRows()) {
                if (ordinal < size) await sink.appendDerived(ordinal, content);
                ordinal++;
              }
            },
          },
          journal.host,
          undefined,
          {},
        );
        const prior = await journal.session.store.snapshot();
        try {
          await journal.store.publishDetached(
            {
              append: true,
              transform: async (source, sink) => {
                await sink.removeValue(0);
                await sink.appendValue(row(size + 9));
                let ordinal = 0;
                for await (const content of source.streamRows())
                  await sink.appendDerived(ordinal++, { ...content });
              },
            },
            journal.host,
            undefined,
            { origin },
          );
          const current = await journal.session.store.snapshot();
          try {
            expect(current.rows).toBe(size * 2 + 1);
            expect(current.version?.mutation).toBe(MUTATION.append);
            expect(current.version?.roots.rowRoot).not.toBe(
              prior.version?.roots.rowRoot,
            );
            await assertCopiedOwners(current, prior, size);
            expect(await journal.originsOfRows()).toStrictEqual([
              ...Array.from(
                { length: size },
                (_, index) => owners[index % owners.length],
              ),
              historyOriginId(origin),
              ...Array.from(
                { length: size },
                (_, index) => owners[index % owners.length],
              ),
            ]);
            expect(
              decodeStoredRow(await prior.readRow(await prior.entryAt(0)))
                .blocks,
            ).toStrictEqual(row(0).blocks);
          } finally {
            await current.close();
          }
        } finally {
          await prior.close();
        }
      } finally {
        await journal.dispose();
      }
    },
    180_000,
  );
});
