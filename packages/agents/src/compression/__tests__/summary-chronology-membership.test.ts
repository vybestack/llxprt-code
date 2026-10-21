/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { JournalDumpSnapshot } from '../../../../core/src/services/history/journalDumpSnapshot.js';
import { annotateCompressionSpan } from '../../../../core/src/services/history/historyChronology.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { summaryOutput } from '../summaryOutput.js';
import { replacedSpan } from '../diskTruncation.js';
import { operationFileCreates } from './support/operation-file-creates.js';

function row(
  seq: number | undefined,
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata:
      seq === undefined
        ? {}
        : { chronology: { seq, userTurn: 1, step: 0, recordedAt: 0 } },
  };
}

const summary: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'summary' }],
  metadata: { isSummary: true },
};

describe('native summary chronology membership', () => {
  const directory = useTempDir('native-summary-membership-');
  it.each([
    { seqs: [8, 2, 8, 4, 2, 9] },
    { seqs: [undefined, 4, 4, undefined, 1, 1] },
    { seqs: [10, 9, 8, 7, 6, 5] },
  ])(
    'matches independent distinct-sequence annotation for $seqs',
    async ({ seqs }) => {
      const session = await JournalSession.create(
        join(directory(), 'membership.llxj'),
      );
      const rows = seqs.map((seq, index) =>
        row(seq, `r${index}`, index % 2 === 0 ? 'human' : 'ai'),
      );
      await session.append(rows);
      const dump = new JournalDumpSnapshot(await session.store.snapshot());
      try {
        for (const [top, bottom, start] of [
          [1, 4, 0],
          [0, 6, 0],
          [2, 4, 1],
        ]) {
          const output = summaryOutput(dump, top, bottom, [summary]);
          if (output.kind !== 'applied')
            throw new Error('Expected summary descriptor');
          const kept = [
            ...rows.slice(0, top),
            summary,
            ...rows.slice(bottom),
          ].slice(start);
          const oracle = annotateCompressionSpan(rows, kept).find(
            (content) => content.metadata?.isSummary === true,
          );
          let actual: Awaited<ReturnType<typeof replacedSpan>> | undefined;
          const creates = await operationFileCreates(async () => {
            actual = await replacedSpan(dump, output.candidate, start);
          });
          expect(creates).toStrictEqual({ directories: [], files: [] });
          expect(actual?.span).toStrictEqual(
            oracle?.metadata?.chronologyReplaced ?? {
              fromSeq: Infinity,
              toSeq: -Infinity,
              itemCount: 0,
            },
          );
        }
      } finally {
        await dump.close();
        await session.close();
      }
    },
  );

  it('keeps the old version after clear and rejects cancellation before querying', async () => {
    const session = await JournalSession.create(
      join(directory(), 'pinned.llxj'),
    );
    const rows = [
      row(7, 'first'),
      row(7, 'second', 'ai'),
      row(2, 'third'),
      row(9, 'tail'),
    ];
    await session.append(rows);
    const dump = new JournalDumpSnapshot(await session.store.snapshot());
    try {
      const output = summaryOutput(dump, 0, 3, [summary]);
      if (output.kind !== 'applied')
        throw new Error('Expected summary descriptor');
      await session.store.commit([{ kind: 'clear' }]);
      await session.append([row(99, 'current')]);
      expect(
        (await replacedSpan(dump, output.candidate, 0)).span,
      ).toStrictEqual({ fromSeq: 2, toSeq: 7, itemCount: 2 });
      const controller = new AbortController();
      const failure = new Error('cancel before membership');
      controller.abort(failure);
      await expect(
        replacedSpan(dump, output.candidate, 0, controller.signal),
      ).rejects.toBe(failure);
    } finally {
      await dump.close();
      await session.close();
    }
  });
  it('keeps distinct repeated-sequence source rows and every block of a multi-unit row without preserving uncurated holes', async () => {
    const session = await JournalSession.create(
      join(directory(), 'source-rows.llxj'),
    );
    const calls: IContent = {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: 'first', name: 'read_file', parameters: {} },
        { type: 'tool_call', id: 'second', name: 'read_file', parameters: {} },
      ],
      metadata: row(8, 'marker').metadata,
    };
    const rows = [
      row(8, 'head'),
      {
        speaker: 'ai',
        blocks: [],
        metadata: row(42, 'uncurated').metadata,
      } satisfies IContent,
      calls,
      row(2, 'removed'),
    ];
    await session.append(rows);
    const dump = new JournalDumpSnapshot(await session.store.snapshot());
    try {
      const output = summaryOutput(dump, 2, 3, [summary]);
      if (output.kind !== 'applied')
        throw new Error('Expected summary descriptor');
      expect(
        (await replacedSpan(dump, output.candidate, 0)).span,
      ).toStrictEqual({ fromSeq: 2, toSeq: 42, itemCount: 2 });
      expect(await output.candidate.readRow(0)).toStrictEqual(rows[0]);
      expect(await output.candidate.readRow(1)).toStrictEqual(calls);
      expect(await output.candidate.sourceOrdinalAt(0)).toBe(0);
      expect(await output.candidate.sourceOrdinalAt(1)).toBe(2);
      expect(output.candidate.length).toBe(3);
    } finally {
      await dump.close();
      await session.close();
    }
  });
});
