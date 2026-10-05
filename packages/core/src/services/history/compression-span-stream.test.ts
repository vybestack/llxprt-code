/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { annotateCompressionSpan } from './historyChronology.js';
import { annotateCompressionSpanStream } from './compression-span-stream.js';
import { suffixRow, withSuffixFixture } from './history-suffix-test-helpers.js';
import { accountingRow } from './token-accounting-stream-test-helpers.js';
import type { IContent } from './IContent.js';
import { isSpeakerContent } from './historyJournalGuards.js';

function summary(): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'independent summary' }],
    metadata: { isSummary: true },
  };
}

function parityRow(index: number, payloadBytes = 2048): IContent {
  const row = accountingRow(index, payloadBytes);
  return {
    ...row,
    ...(index % 11 === 0 ? { speaker: 'ai', blocks: [] } : {}),
    metadata: {
      ...row.metadata,
      ...(index === 3
        ? { semanticMediaPurgeFrontier: { contentIndex: 4, blockIndex: 1 } }
        : {}),
    },
  };
}

describe('raw compression span byte parity', () => {
  it.each([512, 8192])(
    'matches the old annotation bytes over %i independent mixed rows',
    async (size) => {
      await withSuffixFixture(
        size,
        async (history, ownership) => {
          const candidate = [parityRow(1), summary(), parityRow(size - 1)];
          const expected = annotateCompressionSpan(
            Array.from({ length: size }, (_, index) => parityRow(index)),
            candidate,
          );
          const actual = await annotateCompressionSpanStream(
            history.streamRawHistory(),
            candidate,
          );
          expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().liveSerializedBytes).toBe(0);
        },
        2048,
        parityRow,
      );
    },
    120_000,
  );

  it('preserves a valid raw row exceeding 8 MiB without treating the fixture bound as a cap', async () => {
    const payloadBytes = 8 * 1024 * 1024 + 4096;
    await withSuffixFixture(
      1,
      async (history, ownership) => {
        const candidate = [parityRow(1, payloadBytes), summary()];
        const actual = await annotateCompressionSpanStream(
          history.streamRawHistory(),
          candidate,
        );
        expect(JSON.stringify(actual)).toBe(
          JSON.stringify(
            annotateCompressionSpan(
              [accountingRow(0, payloadBytes)],
              candidate,
            ),
          ),
        );
        expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
          8 * 1024 * 1024,
        );
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      payloadBytes,
      accountingRow,
    );
  });
});

describe('raw compression span metadata cases', () => {
  it('keeps the first raw frontier even when serialized external metadata contains null', async () => {
    const first: unknown = JSON.parse(
      '{"speaker":"human","blocks":[],"metadata":{"semanticMediaPurgeFrontier":null}}',
    );
    if (!isSpeakerContent(first)) throw new Error('Invalid raw fixture');
    const later: IContent = {
      speaker: 'tool',
      blocks: [],
      metadata: {
        semanticMediaPurgeFrontier: { contentIndex: 10, blockIndex: 2 },
      },
    };
    const candidate = [summary()];
    const result = await annotateCompressionSpanStream(
      [first, later],
      candidate,
    );
    expect(JSON.stringify(result)).toBe(
      JSON.stringify(annotateCompressionSpan([first, later], candidate)),
    );
  });
  it('counts destroyed sequences once while keeping missing markers, duplicate summaries and frontier precedence unchanged', async () => {
    const marked = suffixRow(3);
    const frontierRow = {
      ...suffixRow(1),
      metadata: {
        semanticMediaPurgeFrontier: { contentIndex: 2, blockIndex: 1 },
      },
    };
    const previous = [marked, marked, suffixRow(1), frontierRow, summary()];
    const candidate = [
      suffixRow(1),
      summary(),
      {
        ...summary(),
        metadata: {
          isSummary: true,
          chronologyReplaced: { fromSeq: 100, toSeq: 101, itemCount: 2 },
        },
      },
    ];
    expect(
      await annotateCompressionSpanStream(previous, candidate),
    ).toStrictEqual(annotateCompressionSpan(previous, candidate));
    expect(candidate[1].metadata?.chronologyReplaced).toBeUndefined();
  });

  it.each([
    { candidate: [] },
    { candidate: [suffixRow(0)] },
    { candidate: [summary()] },
  ])(
    'retains empty, no-summary and no-destruction semantics',
    async ({ candidate }) => {
      const previous = [suffixRow(0)];
      expect(
        await annotateCompressionSpanStream(previous, candidate),
      ).toStrictEqual(annotateCompressionSpan(previous, candidate));
    },
  );
});
