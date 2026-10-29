/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { encodeContentRow } from './journalRowCodec.js';
import { annotateCompressionSpan } from './historyChronology.js';
import type { ChronologyReplacedSpan, IContent } from './IContent.js';

function row(index: number): IContent {
  return {
    speaker: index % 7 === 1 ? 'ai' : 'human',
    blocks: index % 7 === 1 ? [] : [{ type: 'text', text: `source ${index}` }],
    metadata: {
      chronology: {
        seq: ((index * 19) % 23) + 1,
        userTurn: 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}
const summary: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'summary' }],
  metadata: { isSummary: true },
};

function removed(
  previous: readonly IContent[],
  candidate: readonly IContent[],
): ChronologyReplacedSpan {
  const annotated = annotateCompressionSpan(previous, [summary, ...candidate]);
  return (
    annotated[0].metadata?.chronologyReplaced ?? {
      fromSeq: Infinity,
      toSeq: -Infinity,
      itemCount: 0,
    }
  );
}

describe('native compression source-range selection', () => {
  const directory = useTempDir('native-span-selection-');

  it.each([40, 4000])(
    'seeks raw endpoints over %i rows within tree-depth reads and makes repeated queries read-only',
    async (size) => {
      const counter = { reads: 0 };
      const file = join(directory(), 'ranges.llxj');
      const session = await JournalSession.create(file, {
        journal: testJournalSeams({ readCounter: counter }, 1, false)
          .dependencies,
      });
      const rows = Array.from({ length: size }, (_, index) => row(index));
      await session.append(rows);
      const dump = new JournalDumpSnapshot(await session.store.snapshot());
      try {
        const curated = rows.flatMap((content, ordinal) =>
          content.blocks.length === 0 ? [] : [ordinal],
        );
        const before = {
          bytes: statSync(file).size,
          commit: session.store.published?.commitSeq,
        };
        counter.reads = 0;
        const selection = await dump.chronologySelection(dump.length - 2);
        const reads = counter.reads;
        expect(selection).toStrictEqual({
          ranges: [
            {
              from: curated[curated.length - 2],
              to: curated[curated.length - 1] + 1,
            },
          ],
          generated: [],
        });
        const depth = Math.ceil(Math.log2(size) / 6);
        expect(reads).toBeLessThanOrEqual(4 * (depth + 1));
        for (let query = 0; query < 40; query++)
          await dump.chronologySelection(dump.length - 2);
        expect(statSync(file).size - before.bytes).toBe(0);
        expect(
          (session.store.published?.commitSeq ?? 0) - (before.commit ?? 0),
        ).toBe(0);
        process.stdout.write(
          `NATIVE_SPAN_RANGE ${JSON.stringify({ size, reads, depth })}\n`,
        );
      } finally {
        await dump.close();
        await session.close();
      }
    },
    180_000,
  );

  it('matches distinct-sequence array annotation across nonmonotonic markers and uncurated holes', async () => {
    const session = await JournalSession.create(
      join(directory(), 'oracle.llxj'),
    );
    const rows = Array.from({ length: 65 }, (_, index) => row(index));
    await session.append(rows);
    const dump = new JournalDumpSnapshot(await session.store.snapshot());
    try {
      const curated = rows.filter((content) => content.blocks.length > 0);
      for (let start = 0; start <= curated.length; start++) {
        const actual = await dump.compressionSpan(
          await dump.chronologySelection(start),
          false,
        );
        expect(actual.span).toStrictEqual(removed(rows, curated.slice(start)));
      }
      for (const start of [-1, 0.5, dump.length + 1])
        await expect(dump.chronologySelection(start)).rejects.toBeInstanceOf(
          RangeError,
        );
    } finally {
      await dump.close();
      await session.close();
    }
    await expect(dump.chronologySelection(0)).rejects.toThrow('closed');
  });

  it('keeps old source ordinals and queries across pop, append, clone and compaction', async () => {
    const file = join(directory(), 'versions.llxj');
    const session = await JournalSession.create(file);
    const rows = Array.from({ length: 65 }, (_, index) => row(index));
    await session.append(rows);
    const old = new JournalDumpSnapshot(await session.store.snapshot());
    try {
      const saved = {
        ranges: [{ from: 61, to: 65 }],
        generated: [],
      };
      const snapshot = await session.store.snapshot();
      try {
        const last = await snapshot.entryAt(snapshot.rows - 1);
        await session.store.commit([
          { kind: 'pop', cutLabel: last.label, expectedRemoved: 1 },
        ]);
      } finally {
        await snapshot.close();
      }
      await session.append([row(999)]);
      const clone = await session.cloneUnlinked();
      try {
        await clone.store.compact();
        const current = new JournalDumpSnapshot(await clone.store.snapshot());
        try {
          const expected = [...rows.slice(0, -1), row(999)];
          const kept = expected
            .filter((content) => content.blocks.length > 0)
            .slice(-3);
          expect(
            (
              await current.compressionSpan(
                await current.chronologySelection(current.length - 3),
                false,
              )
            ).span,
          ).toStrictEqual(removed(expected, kept));
        } finally {
          await current.close();
        }
      } finally {
        await clone.close();
      }
      expect(await old.chronologySelection(old.length - 3)).toStrictEqual(
        saved,
      );
      expect((await old.compressionSpan(saved, false)).span).toStrictEqual(
        removed(
          rows,
          rows.filter((content) => content.blocks.length > 0).slice(-3),
        ),
      );
    } finally {
      await old.close();
      await session.close();
    }
    const reopened = await JournalSession.open(file);
    try {
      const current = new JournalDumpSnapshot(await reopened.store.snapshot());
      try {
        const expected = [...rows.slice(0, -1), row(999)];
        expect(
          (
            await current.compressionSpan(
              await current.chronologySelection(current.length - 3),
              false,
            )
          ).span,
        ).toStrictEqual(
          removed(
            expected,
            expected.filter((content) => content.blocks.length > 0).slice(-3),
          ),
        );
      } finally {
        await current.close();
      }
    } finally {
      await reopened.close();
    }
  });

  it('uses the pinned generation when equal curated ranks have different raw ordinals after a rewrite', async () => {
    const session = await JournalSession.create(
      join(directory(), 'same-rank.llxj'),
    );
    await session.append(Array.from({ length: 65 }, (_, index) => row(index)));
    const snapshot = await session.store.snapshot();
    const old = new JournalDumpSnapshot(snapshot);
    try {
      expect(await old.chronologySelection(3)).toStrictEqual({
        ranges: [{ from: 4, to: 65 }],
        generated: [],
      });
      const second = await snapshot.entryAt(1);
      await session.store.commit([
        {
          kind: 'purge',
          rows: [
            {
              label: second.label,
              draft: encodeContentRow(row(1001), { owner: second.owner }),
            },
          ],
        },
      ]);
      const current = new JournalDumpSnapshot(await session.store.snapshot());
      try {
        expect(await current.chronologySelection(3)).toStrictEqual({
          ranges: [{ from: 3, to: 65 }],
          generated: [],
        });
        expect(await old.sourceOrdinalAt(3)).toBe(4);
      } finally {
        await current.close();
      }
    } finally {
      await old.close();
      await session.close();
    }
  });
});
