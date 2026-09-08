/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { parseImageDimensions } from '../../packages/tools/src/utils/imageDimensions.js';
import {
  evaluateMediaProbePlateaus,
  mediaProbeImageBytes,
  type MediaProbeTurnSample,
} from '../issue-3199-media-memory-benchmark.js';

const IMAGE_BYTES = 512 * 1024;

function imageContentId(turn: number): string {
  const digest = createHash('sha256')
    .update(mediaProbeImageBytes(turn, IMAGE_BYTES))
    .digest('hex');
  return `sha256:${digest}`;
}

function sample(
  turn: number,
  external: number = 20_000_000,
  heapUsed: number = 40_000_000 + turn * 10_000,
): MediaProbeTurnSample {
  const decodedImageCache: MediaProbeTurnSample['settled']['decodedImageCache'] =
    {
      available: false,
      entries: null,
      bytes: null,
    };
  const retainedBlobBytes = turn * 524_288;
  const lifecycle = {
    localRetainedBlobBytes: retainedBlobBytes,
    residentEncodedBytes: 0,
    activeRequestMaterializationBytes: 0,
    recordingQueueBytes: 0,
    persistenceQueueBytes: 0,
    diskSpoolBytes: retainedBlobBytes,
    decodedImageCache,
    providerFileRetainedBytes: 524_288,
    process: {
      heapUsed,
      external,
      arrayBuffers: 2_000_000,
      rss: 120_000_000 + turn * 100_000,
    },
    osPeakFootprintBytes: 130_000_000 + turn * 100_000,
  };
  return {
    turn,
    contentId: imageContentId(turn),
    uniqueContentCount: turn,
    active: {
      ...lifecycle,
      activeRequestMaterializationBytes: 699_052,
      recordingQueueBytes: 2_000 + turn * 100,
      persistenceQueueBytes: 3_000 + turn * 200,
    },
    settled: lifecycle,
    transportBytes: 700_000,
    settledActiveRequestCount: 0,
    settledReservedContentCount: 0,
    settledPendingReleaseCount: 0,
    settledStoreReadCount: turn,
    settledProviderFileCount: 1,
    settledHistoryContentCount: 1,
    settledSupersededHistoryOwnerCount: 0,
    bounds: {
      storeQuotaBytes: 10 * 524_288,
      requestBudgetBytes: 8 * 1024 * 1024,
      recordingQueueBytes: 8 * 1024 * 1024,
      persistenceQueueBytes: 8 * 1024 * 1024,
      providerFileMaxFiles: 1,
      providerFileMaxBytes: 524_288,
    },
  };
}

describe('issue 3199 media probe image identity', () => {
  it('produces deterministic bytes that remain a valid PNG image', () => {
    const first = mediaProbeImageBytes(1, IMAGE_BYTES);
    const again = mediaProbeImageBytes(1, IMAGE_BYTES);

    expect(Buffer.from(first).equals(Buffer.from(again))).toBe(true);
    expect(first.byteLength).toBe(IMAGE_BYTES);
    expect([...first.subarray(0, 8)]).toStrictEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(parseImageDimensions(first)).toStrictEqual({ width: 1, height: 1 });
  });

  it('gives every turn a distinct SHA-256 content identity', () => {
    const identities = new Set(
      Array.from({ length: 6 }, (_, index) => imageContentId(index + 1)),
    );

    expect(identities.size).toBe(6);
  });

  it('rejects a non-positive turn and an undersized payload', () => {
    expect(() => mediaProbeImageBytes(0, IMAGE_BYTES)).toThrow('turn');
    expect(() => mediaProbeImageBytes(1, 32)).toThrow('byte length');
  });
});

describe('issue 3199 media memory benchmark', () => {
  it('reports an explicit plateau verdict and raw observations for every metric', () => {
    const result = evaluateMediaProbePlateaus(
      Array.from({ length: 6 }, (_, index) => sample(index + 1)),
    );

    expect(result.overallWithinTolerance).toBe(true);
    expect(result.warmupExcludedTurns).toStrictEqual([2, 3, 4, 5, 6]);
    expect(result.metrics.map((metric) => metric.name)).toStrictEqual([
      'localRetainedBlobBytes',
      'residentEncodedBytes',
      'activeRequestMaterializationBytes',
      'recordingQueueBytes',
      'persistenceQueueBytes',
      'diskSpoolBytes',
      'decodedImageCacheEntries',
      'decodedImageCacheBytes',
      'providerFileRetainedBytes',
      'heapUsed',
      'external',
      'arrayBuffers',
      'rss',
      'osPeakFootprintBytes',
    ]);
    expect(
      result.metrics.find((metric) => metric.name === 'external')?.observations,
    ).toStrictEqual(Array.from({ length: 5 }, () => 20_000_000));
    expect(
      result.metrics.find((metric) => metric.name === 'decodedImageCacheBytes'),
    ).toMatchObject({ available: false, withinTolerance: true });
  });

  it('treats expected unique spool growth as bounded rather than a leak', () => {
    const result = evaluateMediaProbePlateaus(
      Array.from({ length: 6 }, (_, index) => sample(index + 1)),
    );

    const localBlob = result.metrics.find(
      (metric) => metric.name === 'localRetainedBlobBytes',
    );
    const diskSpool = result.metrics.find(
      (metric) => metric.name === 'diskSpoolBytes',
    );
    expect(localBlob).toMatchObject({
      withinTolerance: true,
      available: true,
      boundBytes: 10 * 524_288,
    });
    expect(diskSpool).toMatchObject({
      withinTolerance: true,
      available: true,
      boundBytes: 10 * 524_288,
    });
    expect(localBlob?.observations).toStrictEqual(
      [1, 2, 3, 4, 5, 6].map((turn) => turn * 524_288),
    );
    expect(diskSpool?.observations).toStrictEqual(
      [1, 2, 3, 4, 5, 6].map((turn) => turn * 524_288),
    );
  });

  it('fails the overall verdict when one independently measured metric grows past its allowance', () => {
    const external = [20, 20, 40, 60, 80, 100].map(
      (megabytes) => megabytes * 1024 * 1024,
    );
    const result = evaluateMediaProbePlateaus(
      external.map((bytes, index) => sample(index + 1, bytes)),
    );

    expect(result.overallWithinTolerance).toBe(false);
    expect(
      result.metrics.find((metric) => metric.name === 'external'),
    ).toMatchObject({ withinTolerance: false, available: true });
  });

  it('allows a bounded transient heap spike that settles in later forced-GC samples', () => {
    const heapUsed = [40, 40, 60, 42, 41].map(
      (megabytes) => megabytes * 1024 * 1024,
    );
    const result = evaluateMediaProbePlateaus(
      heapUsed.map((bytes, index) => sample(index + 1, 20_000_000, bytes)),
    );

    expect(
      result.metrics.find((metric) => metric.name === 'heapUsed'),
    ).toMatchObject({ withinTolerance: true, available: true });
  });

  it('rejects a workload that reuses one content ID across turns', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const reused = { ...samples[3], contentId: samples[2].contentId };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        samples[2],
        reused,
        samples[4],
      ]),
    ).toThrow('reused content ID');
  });

  it('rejects a unique content count that does not match observed content IDs', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const mismatched = { ...samples[3], uniqueContentCount: 10 };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        samples[2],
        mismatched,
        samples[4],
      ]),
    ).toThrow('unique content count');
  });

  it('rejects spool growth that breaches the store quota', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const overQuota = {
      ...samples[4],
      settled: {
        ...samples[4].settled,
        localRetainedBlobBytes: 11 * 524_288,
        diskSpoolBytes: 11 * 524_288,
      },
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        samples[2],
        samples[3],
        overQuota,
      ]),
    ).toThrow('store quota');
  });

  it('rejects unsettled request reservations and pending releases after a turn', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const unsettled = {
      ...samples[2],
      settledActiveRequestCount: 1,
      settledReservedContentCount: 2,
      settledPendingReleaseCount: 1,
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        unsettled,
        samples[3],
        samples[4],
      ]),
    ).toThrow('settle');
  });

  it('rejects settled request bytes left behind after request accounting reaches zero', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const unsettled = {
      ...samples[2],
      settled: {
        ...samples[2].settled,
        activeRequestMaterializationBytes: 1,
      },
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        unsettled,
        samples[3],
        samples[4],
      ]),
    ).toThrow('did not release request and queue bytes');
  });

  it('rejects a queue that exceeds its configured byte bound', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const overQueue = {
      ...samples[2],
      active: {
        ...samples[2].active,
        persistenceQueueBytes: 8 * 1024 * 1024 + 1,
        diskSpoolBytes: samples[2].active.diskSpoolBytes,
      },
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        overQueue,
        samples[3],
        samples[4],
      ]),
    ).toThrow('persistence queue');
  });

  it('rejects a provider file count over its configured limit', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const overFiles = { ...samples[3], settledProviderFileCount: 2 };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        samples[2],
        overFiles,
        samples[4],
      ]),
    ).toThrow('provider file max files');
  });

  it('rejects a settled turn that retains more than its current history entry', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const retainedHistory = {
      ...samples[2],
      settledHistoryContentCount: 2,
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        retainedHistory,
        samples[3],
        samples[4],
      ]),
    ).toThrow('retained 2 history entries instead of one');
  });

  it('rejects a settled turn that keeps a superseded history owner', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const retainedOwner = {
      ...samples[2],
      settledSupersededHistoryOwnerCount: 1,
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        retainedOwner,
        samples[3],
        samples[4],
      ]),
    ).toThrow('retained 1 superseded history owners');
  });

  it('rejects insufficient post-warm-up samples', () => {
    expect(() =>
      evaluateMediaProbePlateaus(
        Array.from({ length: 4 }, (_, index) => sample(index + 1)),
      ),
    ).toThrow('at least 5 turns');
  });

  it('rejects a missing required measurement instead of treating it as zero', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const malformed = {
      ...samples[3],
      settled: {
        ...samples[3].settled,
        process: { ...samples[3].settled.process, arrayBuffers: Number.NaN },
      },
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        samples[2],
        malformed,
        samples[4],
      ]),
    ).toThrow('arrayBuffers');
  });

  it('rejects inconsistent decoded-image cache availability between samples', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));
    const decodedImageCache: MediaProbeTurnSample['settled']['decodedImageCache'] =
      {
        available: true,
        entries: 2,
        bytes: 640,
      };
    const malformed = {
      ...samples[2],
      settled: {
        ...samples[2].settled,
        decodedImageCache,
      },
    };

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[0],
        samples[1],
        malformed,
        samples[3],
        samples[4],
      ]),
    ).toThrow('decodedImageCache');
  });

  it('rejects samples that are not ordered from the warm-up turn onward', () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index + 1));

    expect(() =>
      evaluateMediaProbePlateaus([
        samples[1],
        samples[0],
        samples[2],
        samples[3],
        samples[4],
      ]),
    ).toThrow('ordered by increasing turn starting at turn 1');
  });
});
