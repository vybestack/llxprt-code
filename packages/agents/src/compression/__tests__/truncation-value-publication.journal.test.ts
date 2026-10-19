/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { nativeTruncationSourceFailure } from './support/native-truncation-source.js';
import { expectedTruncationValue } from './truncation-value-helpers.js';

async function* expectedSummaryRows(): AsyncGenerator<IContent> {
  for (let index = 11; index < 32; index++) {
    const row = expectedTruncationValue(index, 11);
    yield {
      ...row,
      metadata: {
        ...row.metadata,
        ...(index === 11 ? { cacheAnchor: true } : {}),
        ...(index === 12
          ? {
              isSummary: true,
              reason: 'compression-state-snapshot',
              chronologyReplaced: { fromSeq: 1, toSeq: 11, itemCount: 11 },
            }
          : {}),
      },
    };
  }
}
import {
  exactTokenizer,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import {
  transformProbes,
  transformPhaseSampler,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';
import { probedTransformInput } from '@vybestack/llxprt-code-core/services/history/__tests__/support/transform-value-fixtures-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { publishCandidate } from '../diskTruncation.js';
import { curatedCandidate } from '../curatedCandidate.js';
import {
  executeTruncation,
  truncationValueRow,
  truncationValues,
} from './truncation-value-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  fallbackHarness,
  enforceFallback,
} from './provider-fallback-disk-helpers.js';
import {
  withNativeFallbackFixture,
  reachesGate,
} from './support/native-fallback-fixture.js';
import { observeNativeTruncation } from './support/native-truncation-observers.js';

async function rejectedPublication(
  size: number,
  mode: 'cancel' | 'admission',
): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    const probes = transformProbes();
    await history.detachedValues.replace(
      probedTransformInput(size, truncationValueRow, owners, probes),
    );
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    const before = await compressionValueDigest(truncationValues(size));
    const signal = new AbortController();
    let failure = new Error('cancelled while real content writer held');
    const sample = transformPhaseSampler(
      `native-truncation-${mode}`,
      size,
      owners,
      probes,
    );
    const published = observeNativeTruncation(
      history,
      () => {
        if (mode === 'admission') failure = fixture.failAdmissionAfter(1);
      },
      signal.signal,
    );
    if (mode === 'cancel') fixture.pauseWriter();
    const operation = rejectedValue(
      executeTruncation(history, size).then(() => {}),
    );
    try {
      if (mode === 'cancel') {
        await reachesGate(fixture.writerPaused, operation);
        expect(owners.snapshot().liveRows).toBeGreaterThan(0);
        await sample('writer-paused');
        await published('writer-paused');
        signal.abort(failure);
        fixture.releaseWriter();
      }
      expect(await operation).toBe(failure);
      history.setTokenizerFactory(exactTokenizer());
      await sample('rollback');
      await published('rollback');
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(await durable()).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(size + 37);
      expect(history.getBaseTokenOffset()).toBe(37);
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
    } finally {
      fixture.releaseWriter();
      await operation;
    }
  });
}

async function sourceAdmission(size: number): Promise<void> {
  await withNativeFallbackFixture(async (fixture) => {
    const { history, owners, durable } = fixture;
    await history.detachedValues.replace(truncationValues(size));
    history.setBaseTokenOffset(37);
    history.setCacheAnchorSeq(1);
    const before = await compressionValueDigest(truncationValues(size));
    const projectionFailure = new Error(
      'projection after partial native truncation',
    );
    let attempted = false;
    let admission: Error | undefined;
    const transform = history.detachedValues.transform;
    observeNativeTruncation(history, () => {
      admission = fixture.failAdmissionAfter(1);
    });
    const harness = fallbackHarness(history, async () => {
      const failure = await rejectedValue(
        executeTruncation(history, size).then(() => {}),
      );
      expect(admission).toBeInstanceOf(Error);
      expect(failure).toBe(admission);
      attempted = true;
      throw failure;
    });
    const error = await rejectedValue(
      enforceFallback({
        ...harness,
        estimate: async () => {
          if (attempted) throw projectionFailure;
          return 150_000;
        },
      }).then(() => {}),
    );
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error('Missing stage error');
    expect(error.message).toBe(
      `Token projection failed at post-truncation stage during provider-content hard-limit enforcement: ${projectionFailure.message}`,
    );
    expect(error.cause).toBe(projectionFailure);
    expect(harness.baseline()).toBe(123);
    history.setTokenizerFactory(exactTokenizer());
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(before);
    expect(await durable()).toStrictEqual(before);
    expect(history.getTotalTokens()).toBe(size + 37);
    expect(history.getBaseTokenOffset()).toBe(37);
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    history.detachedValues.transform = transform;
    expect((await executeTruncation(history, size)).outcome).toBe('applied');
    const selected = await compressionValueDigest(
      truncationValues(size, 11, 2048, true),
    );
    expect(
      await compressionValueDigest(history.streamRawHistory()),
    ).toStrictEqual(selected);
    expect(await durable()).toStrictEqual(selected);
    expect(owners.snapshot().liveRows).toBe(0);
  });
}

async function* summaryRows(): AsyncGenerator<IContent> {
  for (let index = 0; index < 32; index++) {
    const row = truncationValueRow(index);
    yield index === 12
      ? {
          ...row,
          metadata: {
            ...row.metadata,
            isSummary: true,
            reason: 'compression-state-snapshot',
          },
        }
      : row;
  }
}

const cases = [512, 8192].flatMap((size) =>
  (['cancel', 'admission'] satisfies Array<'cancel' | 'admission'>).map(
    (mode) => ({ size, mode }),
  ),
);
describe('native truncation publication and source enforcement', () => {
  for (const { size, mode } of cases) {
    it(`restores complete ${size}-row live and durable values on ${mode}`, async () => {
      await expect(rejectedPublication(size, mode)).resolves.toBeUndefined();
    }, 120_000);
  }
  for (const size of [512, 8192]) {
    it(`closes the failed native source, preserves all ${size} rows and retries truncation`, async () => {
      expect(await nativeTruncationSourceFailure(size)).toBe(size);
    }, 120_000);
    it(`preserves baseline and stage cause through enclosing source partial admission at ${size} rows`, async () => {
      await expect(sourceAdmission(size)).resolves.toBeUndefined();
    }, 120_000);
  }
  it('returns the production truncation summary and preserves exact cache/frontier/replaced chronology', async () => {
    await withNativeFallbackFixture(async ({ history, durable }) => {
      await history.detachedValues.replace(summaryRows());
      const result = await executeTruncation(history, 32);
      expect(result.outcome).toBe('applied');
      expect(result.summary?.metadata?.chronologyReplaced).toStrictEqual({
        fromSeq: 1,
        toSeq: 11,
        itemCount: 11,
      });
      expect(result.summary?.metadata?.chronology?.seq).toBe(13);
      expect(result.summary?.metadata?.reason).toBe(
        'compression-state-snapshot',
      );
      await history.detachedValues.replace(summaryRows());
      await history.detachedValues.withCheckpoint(async (previous) => {
        const candidate = await curatedCandidate(checkpointRows(previous));
        try {
          const summary = await publishCandidate(
            history,
            { rows: () => checkpointRows(previous) },
            candidate,
            11,
            'test',
            1,
          );
          expect(summary?.metadata?.chronologyReplaced).toStrictEqual({
            fromSeq: 1,
            toSeq: 11,
            itemCount: 11,
          });
          expect(summary?.metadata?.chronology?.seq).toBe(13);
          expect(history.getCacheAnchorSeq()).toBe(12);
          const anchors: number[] = [];
          let count = 0;
          let first: IContent | undefined;
          for await (const row of history.streamRawHistory()) {
            if (row.metadata?.cacheAnchor === true)
              anchors.push(row.metadata.chronology?.seq ?? -1);
            if (count++ === 0) first = row;
          }
          expect(first?.metadata?.semanticMediaPurgeFrontier).toStrictEqual({
            contentIndex: 1,
            blockIndex: 0,
          });
          expect(count).toBe(21);
          expect(anchors).toStrictEqual([12]);
          const expected = await compressionValueDigest(expectedSummaryRows());
          expect(
            await compressionValueDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await durable()).toStrictEqual(expected);
        } finally {
          candidate.close();
        }
      });
    });
  });
  it('takes a native checkpoint on structural no-op without publication or anchor reset', async () => {
    await withNativeFallbackFixture(async ({ history, durable }) => {
      await history.detachedValues.replace(truncationValues(2));
      history.setCacheAnchorSeq(1);
      history.openDumpSnapshot = async () => {
        throw new Error('Borrowed dump no-op reached');
      };
      history.detachedValues.transform = async () => {
        throw new Error('No-op published a replacement');
      };
      expect((await executeTruncation(history, 2)).outcome).toBe('noop');
      const expected = await compressionValueDigest(truncationValues(2));
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(expected);
      expect(await durable()).toStrictEqual(expected);
      expect(history.getCacheAnchorSeq()).toBe(1);
    });
  });
});
