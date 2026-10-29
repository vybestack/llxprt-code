/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { describe, expect, it } from 'bun:test';
import { statSync } from 'node:fs';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { recordJournal } from '../../recording/__tests__/support/recordedJournals.js';
import { resumeSession } from '../../recording/resumeSession.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import {
  withNativeDetachedFixture,
  type NativeDetachedFixture,
} from './__tests__/support/detached-contract-fixture.js';
import {
  exactTokenizer,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedRow,
} from './detached-rollback-test-helpers.js';
import type { DetachedHistoryOptions } from './detachedHistoryAPI.js';
import type { HistoryBatchEvent } from './history-batch-values.js';

const cases = [
  'noop',
  'prefix',
  'replace',
  'chronology-prefix',
  'media-prefix',
  'summary',
  'mixed-summary',
  'removals-only',
  'empty',
] as const;

function inputRows(kind: (typeof cases)[number]): IContent[] {
  const rows = Array.from({ length: 4 }, (_, index) =>
    detachedRow(index, 8192),
  );
  if (kind === 'media-prefix')
    return rows.map((row, index) =>
      index === 1
        ? {
            ...row,
            blocks: [
              {
                type: 'media',
                encoding: 'base64',
                mimeType: 'image/png',
                data: 'aGVsbG8=',
                caption: 'kept picture',
              },
            ],
          }
        : row,
    );
  if (kind === 'mixed-summary')
    return [
      ...rows.slice(0, 3),
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'unmarked caller row' }],
      },
    ];
  return rows;
}

function replacement(
  kind: (typeof cases)[number],
  rows: readonly IContent[],
): IContent[] {
  switch (kind) {
    case 'noop':
      return [...rows];
    case 'prefix':
    case 'media-prefix':
      return rows.slice(0, 2);
    case 'empty':
      return [];
    case 'removals-only':
      return [rows[0], rows[3]];
    case 'chronology-prefix':
      return [
        rows[0],
        {
          ...rows[1],
          metadata: {
            ...rows[1].metadata,
            chronology: { seq: 99, userTurn: 2, step: 0, recordedAt: 0 },
          },
        },
      ];
    case 'summary':
    case 'mixed-summary':
      return [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: '<state_snapshot>kept</state_snapshot>' },
          ],
          metadata: {
            chronology: { seq: 5, userTurn: 5, step: 0, recordedAt: 0 },
          },
        },
      ];
    case 'replace':
      return rows.map((row, index) =>
        index === 2
          ? { ...row, blocks: [{ type: 'text', text: 'different middle row' }] }
          : row,
      );
    default:
      throw new Error(`Unknown detached shape: ${kind}`);
  }
}

async function* values(
  rows: readonly IContent[],
): AsyncGenerator<IContent, void, unknown> {
  yield* rows;
}

describe('native detached public shapes', () => {
  it.each([...cases])(
    'publishes %s with complete persisted values and one receipt after acknowledgement',
    async (kind) => {
      await withNativeDetachedFixture(
        async ({ history, session, durable, owners }) => {
          const rows = inputRows(kind);
          await history.detachedValues.replace(rows);
          await history.waitForCommit();
          const next = replacement(kind, rows);
          const expected = await detachedDigest(values(next));
          const before = session.store.published?.commitSeq;
          const bytes = statSync(session.path).size;
          const prior = await session.store.snapshot();
          const offsets: number[] = [];
          for await (const entry of prior.entries())
            offsets.push(entry.recordOffset);
          await prior.close();
          const receipts: Array<
            Promise<Awaited<ReturnType<typeof detachedDigest>>>
          > = [];
          const order: string[] = [];
          let escaped: HistoryBatchEvent | undefined;
          history.on('contentBatchAdded', (source) => {
            escaped = source;
            order.push('batch');
            receipts.push(detachedDigest(source.rows()));
            expect(session.store.published?.commitSeq).toBe(
              kind === 'noop' ? before : (before ?? 0) + 1,
            );
          });
          history.on('tokensUpdated', () => {
            order.push('tokens');
          });
          history.on('contextRangeChanged', () => {
            order.push('range');
          });
          await publishShape(history, kind, next, {
            publishBatch: true,
            onAcknowledged: () => {
              order.push('ack');
            },
            afterPublication: () => {
              order.push('after');
            },
          });
          expect(order).toStrictEqual([
            'batch',
            'tokens',
            'ack',
            'after',
            'range',
          ]);
          expect(await Promise.all(receipts)).toStrictEqual([expected]);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await durable()).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(
            next.reduce((sum, row) => sum + row.blocks.length, 0) +
              (kind === 'media-prefix' ? 1000 : 0),
          );
          expect(session.store.published?.commitSeq).toBe(
            kind === 'noop' ? before : (before ?? 0) + 1,
          );
          await expectShapeLayout(kind, session, bytes, offsets, next.length);
          if (escaped === undefined) throw new Error('Missing receipt');
          await expect(escaped.rows().next()).rejects.toThrow('retired');
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    },
  );
});

describe('native shape publication failure', () => {
  it.each(['records', 'trailer'] as const)(
    'keeps the prior complete version and announces nothing on a failed %s write',
    async (stage) => {
      await withNativeDetachedFixture(
        async ({ history, io, durable, owners }) => {
          const rows = inputRows('replace');
          await history.detachedValues.replace(rows);
          await history.waitForCommit();
          const expected = await detachedDigest(values(rows));
          const failure = new Error(`${stage} write`);
          const events: string[] = [];
          history.on('contentBatchAdded', () => {
            events.push('batch');
          });
          history.on('tokensUpdated', () => {
            events.push('tokens');
          });
          history.on('contextRangeChanged', () => {
            events.push('range');
          });
          io.rejectNextWrite(failure, stage);
          expect(
            await rejectedValue(
              history.detachedValues.replace(
                values(replacement('replace', rows)),
                undefined,
                {
                  publishBatch: true,
                  onAcknowledged: () => {
                    events.push('ack');
                  },
                },
              ),
            ),
          ).toBe(failure);
          expect(events).toStrictEqual([]);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await durable()).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(16);
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    },
  );
});

async function publishShape(
  history: HistoryService,
  kind: (typeof cases)[number],
  next: readonly IContent[],
  options: DetachedHistoryOptions,
): Promise<void> {
  if (kind !== 'removals-only') {
    await history.detachedValues.replace(values(next), undefined, options);
    return;
  }
  await history.detachedValues.transform(
    async (source, sink) => {
      let ordinal = 0;
      for await (const row of source.streamRows()) {
        if (ordinal === 1 || ordinal === 2) await sink.removeValue(ordinal);
        else await sink.appendDerived(ordinal, row);
        ordinal++;
      }
    },
    undefined,
    options,
  );
  expect(history.getContextRange().removedInterior).toStrictEqual([
    { start: 2, end: 3, reason: 'density-removed' },
  ]);
}

async function expectShapeLayout(
  kind: (typeof cases)[number],
  session: NativeDetachedFixture['session'],
  bytes: number,
  offsets: readonly number[],
  length: number,
): Promise<void> {
  if (kind === 'noop') expect(statSync(session.path).size).toBe(bytes);
  if (kind !== 'prefix' && kind !== 'media-prefix' && kind !== 'empty') return;
  const current = await session.store.snapshot();
  try {
    const keptOffsets: number[] = [];
    for await (const entry of current.entries())
      keptOffsets.push(entry.recordOffset);
    expect(keptOffsets).toStrictEqual(offsets.slice(0, length));
  } finally {
    await current.close();
  }
}

describe('native mixed marked persisted input', () => {
  const directory = useTempDir('detached-mixed-resume-');
  it('resumes a genuinely unmarked row and publishes its summary as one replacement', async () => {
    const rows = inputRows('mixed-summary');
    const recorded = await recordJournal(directory(), crypto.randomUUID(), {
      rows,
    });
    const resumed = await resumeSession({
      continueRef: recorded.sessionId,
      chatsDir: directory(),
      projectHash: 'project-hash',
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
    });
    if (!resumed.ok) throw new Error(resumed.error);
    const history = new HistoryService({});
    history.setTokenizerFactory(exactTokenizer());
    try {
      await history.adoptResumeBoot(resumed.recording, resumed.boot);
      const chronology = [];
      for await (const row of history.streamRawHistory())
        chronology.push(row.metadata?.chronology?.seq);
      expect(chronology).toStrictEqual([1, 2, 3, undefined]);
      const next = replacement('summary', rows);
      await history.detachedValues.replace(values(next));
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        await detachedDigest(values(next)),
      );
      await history.waitForCommit();
      await collectJournalFileRowsForAssertions(
        recorded.filePath,
        (persisted) => {
          expect(persisted).toStrictEqual(next);
        },
      );
    } finally {
      await history.dispose();
      await resumed.recording.dispose();
      await resumed.lockHandle.release();
    }
  });
});
