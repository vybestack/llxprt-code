/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { createSessionRecorder } from '../../recording/sessionRecorderFactory.js';
import { HistoryService } from './HistoryService.js';
import { JournalSession } from './journalSession.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import {
  JOURNAL_SPAN_WINDOW,
  encodeJournalSpanWindow,
} from './journalSpanWindow.js';

import type { RemovedInteriorSpan } from './historyEventTypes.js';

async function appendAnnotations(
  target: HistoryService,
  size: number,
  summary: IContent,
): Promise<void> {
  const host = target.detachedValues.host();
  await host.journal.publishDetached(
    {
      append: true,
      transform: async (_source, sink) => {
        for (let index = size - 1; index >= 0; index--) {
          const ordinal = (index * 17) % size;
          await sink.appendReplacement(ordinal, row(ordinal + size));
          await sink.removeValue(ordinal);
        }
        await sink.appendValue(summary);
      },
    },
    host,
    undefined,
    {},
  );
}

async function checkMirror(
  file: string | null,
  expected: IContent[],
  standing: RemovedInteriorSpan[],
): Promise<void> {
  if (file === null) throw new Error('Missing summary mirror');
  const session = await JournalSession.open(file);
  try {
    const durable: IContent[] = [];
    for await (const entry of session.rows()) durable.push(entry.content);
    expect(digest(durable)).toBe(digest(expected));
    expect(anchors(durable)).toStrictEqual(anchors(expected));
    expect(await session.store.getMeta(JOURNAL_SPAN_WINDOW)).toStrictEqual(
      encodeJournalSpanWindow(standing),
    );
    expect(session.store.contextSpans()).toStrictEqual([{ start: 1, end: 2 }]);
  } finally {
    await session.close();
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
      ...(index % 65 === 0 ? { cacheAnchor: true } : {}),
    },
  };
}

function digest(rows: readonly IContent[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function anchors(
  rows: readonly IContent[],
): Array<{ index: number; seq: number | undefined; body: string }> {
  return rows.flatMap((content, index) =>
    content.metadata?.cacheAnchor === true
      ? [
          {
            index,
            seq: content.metadata.chronology?.seq,
            body: digest([content]),
          },
        ]
      : [],
  );
}

async function values(history: HistoryService): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const content of history.streamRawHistory()) rows.push(content);
  return rows;
}

describe('annotated append summary spans are independent of the density window', () => {
  const directory = useTempDir('annotated-summary-parity-');
  it.each([512, 8192])(
    'retains the summary, exact latest window and nonempty cache anchors at %i rows in both mirrors',
    async (size) => {
      const history = new HistoryService({ backend: 'journal' });
      const old = new HistoryService({ backend: 'old' });
      history.setTokenizerFactory(exactTokenizer());
      old.setTokenizerFactory(exactTokenizer());
      const mirrors = [0, 1].map((index) =>
        createSessionRecorder(
          {
            sessionId: `summary-${size}-${index}`,
            projectHash: 'summary-parity',
            chatsDir: directory(),
            workspaceDirs: [directory()],
            provider: 'test',
            model: 'test',
          },
          { LLXPRT_HISTORY_BACKEND: 'journal' },
        ),
      );
      const initial = Array.from({ length: size }, (_, index) => row(index));
      const appended = Array.from({ length: size }, (_, index) => {
        const ordinal = ((size - 1 - index) * 17) % size;
        const source = row(ordinal);
        const replacement = row(ordinal + size);
        return {
          ...replacement,
          metadata: {
            ...replacement.metadata,
            chronology: source.metadata?.chronology,
          },
        };
      });
      const summary: IContent = {
        ...row(size * 2),
        metadata: {
          ...row(size * 2).metadata,
          isSummary: true,
          cacheAnchor: true,
          chronologyReplaced: { fromSeq: 1, toSeq: 2, itemCount: 2 },
        },
      };
      const expected = [...initial, ...appended, summary];
      const standing = Array.from(
        { length: Math.min(size, 1024) },
        (_, index) => ({
          start: (Math.max(0, size - 1024) + index) * 4,
          end: (Math.max(0, size - 1024) + index) * 4,
          reason: 'density-removed' as const,
        }),
      );
      const summarySpan = { start: 1, end: 2, reason: 'compressed' as const };
      const range = {
        firstSeq: 0,
        lastSeq: size * 8,
        totalEntries: expected.length,
        approximate: false,
        removedInterior:
          size === 512
            ? [standing[0], summarySpan, ...standing.slice(1)]
            : [summarySpan, ...standing],
      };
      try {
        await history.detachedValues.append(initial);
        await old.detachedValues.append(initial);
        for (const mirror of mirrors) await history.attachJournal(mirror, true);
        await appendAnnotations(history, size, summary);
        await appendAnnotations(old, size, summary);
        await history.waitForCommit();
        expect(old.getContextRange()).toStrictEqual(range);
        expect(digest(await values(old))).toBe(digest(expected));
        expect(history.getContextRange()).toStrictEqual(range);
        expect(history.getContextRange().removedInterior).toContainEqual(
          summarySpan,
        );
        expect(history.getTotalTokens()).toBe(old.getTotalTokens());
        const actual = await values(history);
        expect(actual.length).toBe(size * 2 + 1);
        expect(digest(actual)).toBe(digest(expected));
        expect(anchors(actual)).toStrictEqual(anchors(expected));
        expect(anchors(actual).length).toBeGreaterThan(1);
        for (const mirror of mirrors)
          await checkMirror(mirror.getFilePath(), expected, standing);
      } finally {
        await history.dispose();
        await old.dispose();
        for (const mirror of mirrors) await mirror.dispose();
      }
    },
    180_000,
  );
});
