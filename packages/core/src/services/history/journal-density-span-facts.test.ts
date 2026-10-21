/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { JournalStore } from '../../journal/journalStore.js';
import {
  JournalInputError,
  JournalWriterPoisonedError,
} from '../../journal/errors.js';
import { storeDeps } from '../../journal/__tests__/support/storeFixtures.js';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { JournalDensitySpans } from './journalDensitySpans.js';
import {
  JOURNAL_SPAN_WINDOW,
  encodeJournalSpanWindow,
} from './journalSpanWindow.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';

function separated(index: number): RemovedInteriorSpan {
  return { start: index * 4, end: index * 4, reason: 'density-removed' };
}

function randomSpans(size: number): RemovedInteriorSpan[] {
  let state = 854;
  return Array.from({ length: size }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const start = state % 40000;
    return {
      start,
      end: start + (index % 4),
      reason: index % 2 === 0 ? 'density-removed' : 'density-replaced',
    };
  });
}

describe('unpublished native density span facts', () => {
  const directory = useTempDir('journal-span-facts-');

  it('keeps a physical span write failure poisoned instead of marking it as producer input', async () => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const session = await JournalSession.create(
      join(directory(), 'poison.llxj'),
      { journal: seams.dependencies },
    );
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'prior' }] },
      ]);
      failures.failWriteAt = seams.events.filter(
        (event) => event.type === 'write',
      ).length;
      await expect(
        session.store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              const spans = new JournalDensitySpans(group);
              for (let index = 0; index < 1025; index++)
                await spans.append(separated(index));
            },
          },
        ]),
      ).rejects.toThrow('injected write failure');
      await expect(
        session.append([{ speaker: 'human', blocks: [] }]),
      ).rejects.toThrow(JournalWriterPoisonedError);
    } finally {
      await session.close();
    }
  });

  it.each([1023, 1024, 1025, 8192])(
    'keeps exactly the last 1024 disjoint spans from %i incoming facts',
    async (size) => {
      const session = await JournalSession.create(
        join(directory(), 'cap.llxj'),
      );
      try {
        await session.append([
          { speaker: 'human', blocks: [{ type: 'text', text: 'kept' }] },
        ]);
        const prior = session.store.published;
        const old = await session.store.snapshot();
        let privateBytes = 0;
        try {
          await session.store.commit([
            {
              kind: 'prepared',
              admission: [],
              prepare: async (group) => {
                const spans = new JournalDensitySpans(group);
                const start = group.appender.nextOffset;
                for (let index = size - 1; index >= 0; index--)
                  await spans.append(separated(index));
                privateBytes = group.appender.nextOffset - start;
                const projected = await spans.project([], []);
                expect(projected).toStrictEqual(
                  Array.from({ length: Math.min(size, 1024) }, (_, index) =>
                    separated(Math.max(0, size - 1024) + index),
                  ),
                );
                const metrics = spans.metrics();
                expect(metrics.privateBytes).toBe(privateBytes);
                expect(metrics.privateBytes > 0).toBe(size > 1024);
                expect(metrics.peakResidentSpans).toBeLessThanOrEqual(1024);
                expect(metrics.cacheBytes).toBeLessThanOrEqual(65536);
                expect(metrics.cacheCap).toBe(65536);
                await spans.retain(projected);
              },
            },
          ]);
          expect(session.store.published?.roots.rowRoot).toBe(
            prior?.roots.rowRoot,
          );
          expect(session.store.published?.roots.idRoot).toBe(
            prior?.roots.idRoot,
          );
          expect(session.store.published?.aggregate.liveBytes).toBe(
            prior?.aggregate.liveBytes,
          );
          expect((await old.readRow(await old.entryAt(0))).blocks.length).toBe(
            1,
          );
        } finally {
          await old.close();
        }
        const metadata = await session.store.getMeta(JOURNAL_SPAN_WINDOW);
        expect(metadata?.length).toBe(2 + Math.min(size, 1024) * 15);
        const before = statSync(session.path).size;
        expect(await session.store.compact()).toBe('swapped');
        const after = statSync(session.path).size;
        expect(before - after).toBeGreaterThanOrEqual(privateBytes);
        expect(await session.store.getMeta(JOURNAL_SPAN_WINDOW)).toStrictEqual(
          encodeJournalSpanWindow(
            Array.from({ length: Math.min(size, 1024) }, (_, index) =>
              separated(Math.max(0, size - 1024) + index),
            ),
          ),
        );
        process.stdout.write(
          `SPAN_STORAGE ${JSON.stringify({ size, privateBytes, before, after, metadataBytes: metadata?.length, rowLiveBytes: session.store.published?.aggregate.liveBytes })}\n`,
        );
      } finally {
        await session.close();
      }
    },
    180_000,
  );

  it('matches the independent array merge with overlap, adjacency, stable reasons, standing spans and rewind', async () => {
    const session = await JournalSession.create(
      join(directory(), 'overlap.llxj'),
    );
    const incoming = randomSpans(8192);
    const accumulated: RemovedInteriorSpan[] = [
      { start: 0, end: 8, reason: 'cleared' },
      { start: 13, end: 15, reason: 'compressed' },
    ];
    const trailing: RemovedInteriorSpan[] = [
      { start: 7, end: 14, reason: 'rewound' },
      { start: 40001, end: 40008, reason: 'rewound' },
    ];
    const expected = mergeRemovedInteriorSpans([
      ...accumulated,
      ...incoming.filter((span) => span.reason === 'density-removed'),
      ...incoming.filter((span) => span.reason === 'density-replaced'),
      ...trailing,
    ]).slice(-1024);
    try {
      await session.store.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: async (group) => {
            const spans = new JournalDensitySpans(group);
            for (const span of incoming) await spans.append(span);
            expect(await spans.project(accumulated, trailing)).toStrictEqual(
              expected,
            );
            expect(spans.metrics().peakResidentSpans).toBeLessThanOrEqual(1024);
          },
        },
      ]);
      expect(statSync(session.path).size).toBe(64);
      expect(session.store.published).toBeUndefined();
    } finally {
      await session.close();
    }
  }, 180_000);

  it('aborts private facts and metadata without publishing and preserves the producer cause', async () => {
    const session = await JournalSession.create(
      join(directory(), 'abort.llxj'),
    );
    const failure = new Error('projection failed');
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'prior' }] },
      ]);
      const bytes = statSync(session.path).size;
      const sequence = session.store.published?.commitSeq;
      await expect(
        session.store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              const spans = new JournalDensitySpans(group);
              for (let index = 0; index < 1025; index++)
                await spans.append(separated(index));
              await spans.retain(await spans.project([], []));
              throw new JournalInputError(failure);
            },
          },
        ]),
      ).rejects.toBe(failure);
      expect(statSync(session.path).size - bytes).toBe(0);
      expect((session.store.published?.commitSeq ?? 0) - (sequence ?? 0)).toBe(
        0,
      );
      expect(await session.store.getMeta(JOURNAL_SPAN_WINDOW)).toBeUndefined();
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'after' }] },
      ]);
      expect(session.store.published?.rows).toBe(2);
    } finally {
      await session.close();
    }
  });

  it.each([40, 4000])(
    'retains one fixed span without a full ROW scan over %i existing rows',
    async (size) => {
      const counter = { reads: 0 };
      const store = await JournalStore.create(
        join(directory(), 'read-bound.llxj'),
        storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
        }),
      );
      try {
        await store.commit([
          {
            kind: 'replace',
            rows: (function* () {
              for (let index = 0; index < size; index++)
                yield encodeContentRow(
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: String(index) }],
                  },
                  { owner: 0 },
                );
            })(),
          },
        ]);
        counter.reads = 0;
        await store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              await new JournalDensitySpans(group).retain([separated(0)]);
            },
          },
        ]);
        const firstReads = counter.reads;
        expect(firstReads).toBeLessThanOrEqual(
          4 * Math.ceil(Math.log2(size)) + 20,
        );
        const before = statSync(store.path).size;
        counter.reads = 0;
        await store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              await new JournalDensitySpans(group).retain([separated(0)]);
            },
          },
        ]);
        expect(counter.reads).toBeLessThanOrEqual(
          4 * Math.ceil(Math.log2(size)) + 20,
        );
        expect(statSync(store.path).size - before).toBe(0);
        process.stdout.write(
          `SPAN_READS ${JSON.stringify({ size, firstReads, repeatedReads: counter.reads })}\n`,
        );
      } finally {
        await store.close();
      }
    },
    180_000,
  );
});
