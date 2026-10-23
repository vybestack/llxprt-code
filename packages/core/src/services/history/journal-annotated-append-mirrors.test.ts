/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { createSessionRecorder } from '../../recording/sessionRecorderFactory.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalSession } from './journalSession.js';
import {
  JOURNAL_SPAN_WINDOW,
  encodeJournalSpanWindow,
} from './journalSpanWindow.js';

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `append ${index}` }],
    metadata: {
      chronology: {
        seq: index * 4,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}

async function values(history: HistoryService): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const content of history.streamRawHistory()) result.push(content);
  return result;
}

async function append(history: HistoryService, size: number): Promise<void> {
  const host = history.detachedValues.host();
  await host.journal.publishDetached(
    {
      append: true,
      transform: async (_source, sink) => {
        for (let index = size - 1; index >= 0; index--) {
          await sink.appendReplacement(index, row(size + index));
          await sink.removeValue(index);
        }
      },
    },
    host,
    undefined,
    {},
  );
}

async function assertDurableMirror(
  path: string,
  expected: IContent[],
  metadata: Uint8Array,
): Promise<void> {
  const session = await JournalSession.open(path);
  try {
    const actual: IContent[] = [];
    for await (const entry of session.rows()) actual.push(entry.content);
    expect(actual).toStrictEqual(expected);
    expect(await session.store.getMeta(JOURNAL_SPAN_WINDOW)).toStrictEqual(
      metadata,
    );
    const fork = await session.cloneUnlinked();
    try {
      expect(await fork.store.getMeta(JOURNAL_SPAN_WINDOW)).toStrictEqual(
        metadata,
      );
      await fork.store.compact();
      expect(await fork.store.getMeta(JOURNAL_SPAN_WINDOW)).toStrictEqual(
        metadata,
      );
    } finally {
      await fork.close();
    }
  } finally {
    await session.close();
  }
}

async function seeded(size: number): Promise<HistoryService> {
  const history = new HistoryService({});
  history.setTokenizerFactory(exactTokenizer());
  await history.detachedValues.append(
    Array.from({ length: size }, (_, index) => row(index)),
  );
  return history;
}

describe('annotated append final metadata follows the native mirror FIFO', () => {
  const directory = useTempDir('annotated-append-mirrors-');

  it.each([512, 8192])(
    'matches independent old live values, tokens and annotations and both durable mirrors for %i rows',
    async (size) => {
      const history = await seeded(size);
      const old = await seeded(size);
      const mirrors = [0, 1].map((index) =>
        createSessionRecorder({
          sessionId: `annotations-${size}-${index}`,
          projectHash: 'annotated-fifo',
          chatsDir: directory(),
          workspaceDirs: [directory()],
          provider: 'test',
          model: 'test',
        }),
      );
      try {
        for (const mirror of mirrors) await history.attachJournal(mirror, true);
        await append(old, size);
        await append(history, size);
        await history.waitForCommit();
        const expected = await values(old);
        expect(await values(history)).toStrictEqual(expected);
        expect(history.getTotalTokens()).toBe(old.getTotalTokens());
        expect(history.getContextRange()).toStrictEqual(old.getContextRange());
        const metadata = encodeJournalSpanWindow(
          old.getContextRange().removedInterior,
        );
        for (const mirror of mirrors) {
          const path = mirror.getFilePath();
          if (path === null) throw new Error('Mirror has no durable file');
          await assertDurableMirror(path, expected, metadata);
        }
        await history.clear();
        await history.waitForCommit();
        for (const mirror of mirrors) {
          const path = mirror.getFilePath();
          if (path === null) throw new Error('Mirror has no durable file');
          const session = await JournalSession.open(path);
          try {
            expect(session.store.published?.rows).toBe(0);
          } finally {
            await session.close();
          }
        }
      } finally {
        await history.dispose();
        await old.dispose();
        for (const mirror of mirrors) await mirror.dispose();
      }
    },
    180_000,
  );
});
