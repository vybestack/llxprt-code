/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Sample } from '../../memory/sample.ts';

const MIB = 1024 * 1024;
export const MAX_POST_CLEAR_HEAP_GROWTH = 16 * MIB;
export const MAX_POST_CLEAR_RSS_GROWTH = 96 * MIB;
export const MAX_POST_CLEAR_OBJECT_GROWTH = 180_000;

interface MetricLimit {
  readonly name: 'heapSize' | 'rss' | 'objectCount';
  readonly growth: number;
  readonly limit: number;
}

export function assertBoundedPostClearRetention(
  samples: readonly Sample[],
): void {
  const manual = samples.filter((sample) => sample.tag === 'manual');
  if (manual.length !== 3) {
    // Report the whole sequence: a missing checkpoint means the tmux script
    // moved on before the probe handled a request, and knowing WHICH of the
    // three is absent separates that from a probe that refused the request.
    const seen = samples.map((sample) => sample.tag).join(', ');
    throw new Error(
      `expected exactly 3 manual forced-GC samples, found ${manual.length}. ` +
        `Sample tags in order: [${seen}]. Each manual checkpoint is requested ` +
        `by scripts/memory/request-cli.ts --wait; check probe.log in the same ` +
        `directory for the matching "sample complete" lines.`,
    );
  }

  const baseline = manual[0];
  const postClear = manual[2];
  if (baseline === undefined || postClear === undefined) {
    throw new Error('manual checkpoint selection failed');
  }

  const metrics: readonly MetricLimit[] = [
    {
      name: 'heapSize',
      growth: postClear.heapSize - baseline.heapSize,
      limit: MAX_POST_CLEAR_HEAP_GROWTH,
    },
    {
      name: 'rss',
      growth: postClear.rss - baseline.rss,
      limit: MAX_POST_CLEAR_RSS_GROWTH,
    },
    {
      name: 'objectCount',
      growth: postClear.objectCount - baseline.objectCount,
      limit: MAX_POST_CLEAR_OBJECT_GROWTH,
    },
  ];
  const violations = metrics.filter((metric) => metric.growth > metric.limit);
  if (violations.length > 0) {
    throw new Error(
      `post-clear retention exceeded: ${violations
        .map(
          (metric) =>
            `${metric.name} grew by ${metric.growth}, limit ${metric.limit}`,
        )
        .join('; ')}`,
    );
  }
}
