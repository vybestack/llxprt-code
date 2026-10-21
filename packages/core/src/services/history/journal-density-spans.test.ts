/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import type { IContent } from './IContent.js';

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

  for (const size of [3, 1025])
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
      try {
        await journal.store.publishDetached(
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
      await edit();
      expect(observed.spans()).toStrictEqual([
        { start: 1, end: 1, reason: 'density-replaced' },
      ]);
      const bytes = statSync(journal.session.path).size;
      const commit = journal.session.store.published?.commitSeq;
      await edit();
      expect(statSync(journal.session.path).size - bytes).toBe(0);
      expect(
        (journal.session.store.published?.commitSeq ?? 0) - (commit ?? 0),
      ).toBe(0);
      expect(await journal.originsOfRows()).toStrictEqual(['a']);
    } finally {
      await journal.dispose();
    }
  });
});
