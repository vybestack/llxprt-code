/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { DetachedHistoryOptions } from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import {
  withValueTransformFixture,
  transformProbes,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers-fixtures.js';
import {
  detachedDigest,
  detachedDurableDigest,
} from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { publishCandidate } from '../diskTruncation.js';
import {
  executeTruncation,
  truncationValues,
  truncationValueRow,
} from './truncation-value-helpers.js';

function publish(
  history: HistoryService,
  options: DetachedHistoryOptions,
): Promise<IContent | undefined> {
  return history.detachedValues.withCheckpoint(async (previous) => {
    const candidate = new DetachedHistoryJournal();
    try {
      for (let index = 11; index < previous.length; index++)
        candidate.append(previous.readRow(index));
      return await publishCandidate(
        history,
        {
          async *rows() {
            for (const row of previous) yield row;
          },
        },
        candidate,
        0,
        'test',
        0,
        options,
      );
    } finally {
      candidate.close();
    }
  }, options.signal);
}

async function rejectPublication(
  size: number,
  mode: 'cancel' | 'admission',
): Promise<number> {
  return withValueTransformFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    const probes = transformProbes();
    const sample = transformPhaseSampler(
      `truncation-${mode}`,
      size,
      owners,
      probes,
    );
    await history.detachedValues.replace(
      probedTransformInput(size, truncationValueRow, owners, probes),
    );
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    const expected = await detachedDigest(truncationValues(size));
    const signal = new AbortController();
    const failure = new Error('cancelled while real content writer held');
    if (mode === 'admission') recorder.failAdmissionAfter(3);
    else fixture.pauseWriter();
    const operation = rejectedValue(
      publish(history, { signal: signal.signal }).then(() => {}),
    );
    try {
      if (mode === 'cancel') {
        await Promise.race([
          fixture.writerPaused,
          operation.then((result) => {
            throw new Error(`Ended before writer: ${String(result)}`);
          }),
        ]);
        expect(owners.snapshot().liveRows).toBeGreaterThan(0);
        await sample('writer-paused');
        signal.abort(failure);
        fixture.releaseWriter();
      }
      expect(await operation).toBe(
        mode === 'cancel' ? failure : recorder.failure,
      );
      await sample('rollback');
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        expected,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
      expect(history.getTotalTokens()).toBe(size + 37);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(history.getContextRange()).toStrictEqual({
        firstSeq: 1,
        lastSeq: size,
        totalEntries: size,
        removedInterior: [],
        approximate: false,
      });
      expect(owners.snapshot().liveRows).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      return size;
    } finally {
      fixture.releaseWriter();
      await operation;
    }
  });
}

async function summaryPublication(): Promise<IContent | undefined> {
  return withValueTransformFixture(async ({ history }) => {
    await history.detachedValues.replace(truncationValues(32));
    return history.detachedValues.withCheckpoint(async (previous) => {
      const candidate = new DetachedHistoryJournal();
      try {
        for (let index = 11; index < 32; index++) {
          const row = previous.readRow(index);
          candidate.append(
            index === 12
              ? {
                  ...row,
                  metadata: {
                    ...row.metadata,
                    isSummary: true,
                    reason: 'compression-state-snapshot',
                  },
                }
              : row,
          );
        }
        const result = await publishCandidate(
          history,
          {
            async *rows() {
              for (const row of previous) yield row;
            },
          },
          candidate,
          0,
          'test',
          1,
        );
        expect(result?.metadata?.chronologyReplaced).toStrictEqual({
          fromSeq: 1,
          toSeq: 11,
          itemCount: 11,
        });
        expect(result?.metadata?.chronology?.seq).toBe(13);
        expect(history.getCacheAnchorSeq()).toBe(12);
        const rows: IContent[] = [];
        for await (const row of history.streamRawHistory()) rows.push(row);
        expect(
          rows
            .filter((row) => row.metadata?.cacheAnchor === true)
            .map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([12]);
        expect(rows[0].metadata?.semanticMediaPurgeFrontier).toStrictEqual({
          contentIndex: 1,
          blockIndex: 0,
        });
        return result;
      } finally {
        candidate.close();
      }
    });
  });
}

describe('truncation real publication failure and recording values', () => {
  for (const size of [512, 8192])
    for (const mode of ['cancel', 'admission'] satisfies Array<
      'cancel' | 'admission'
    >) {
      it(`restores complete ${size}-row live and durable values on ${mode}`, async () => {
        expect(await rejectPublication(size, mode)).toBe(size);
      }, 120_000);
    }
  it('returns the marked summary value and preserves cache/frontier/replaced chronology', async () => {
    expect((await summaryPublication())?.metadata?.reason).toBe(
      'compression-state-snapshot',
    );
  });
  it('takes a detached checkpoint on structural no-op without publishing or resetting anchors', async () => {
    await withValueTransformFixture(async ({ history }) => {
      await history.detachedValues.replace(truncationValues(2));
      history.setCacheAnchorSeq(1);
      history.openDumpSnapshot = async () => {
        throw new Error('Borrowed dump no-op reached');
      };
      const result = await executeTruncation(history, 2);
      expect(result.outcome).toBe('noop');
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        await detachedDigest(truncationValues(2)),
      );
      expect(history.getCacheAnchorSeq()).toBe(1);
    });
  });
});
