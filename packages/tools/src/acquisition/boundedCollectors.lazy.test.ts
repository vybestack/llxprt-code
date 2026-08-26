/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-04
 */

import { generateHeapSnapshot } from 'bun';
import { describe, expect, it } from 'bun:test';
import {
  BoundedCombinedCollector,
  BoundedStreamCollector,
  createByteBudget,
} from './index.js';

const COLLECTOR_COUNT = 200;
const UINT8_ARRAY_GROWTH_THRESHOLD = 50;
const BUDGET_BYTES = 512 * 1024;

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
function countHeapClass(name: string): number {
  const snapshot = generateHeapSnapshot();
  // Validate the snapshot layout via a class every JavaScript heap has; a
  // Bun format change must fail loudly instead of silently counting zero.
  if (
    !Array.isArray(snapshot.nodes) ||
    !Array.isArray(snapshot.nodeClassNames) ||
    snapshot.nodes.length % 4 !== 0 ||
    snapshot.nodeClassNames.indexOf('Object') < 0
  ) {
    throw new Error(
      'Unexpected heap snapshot encoding; class counts would be unreliable',
    );
  }
  const classCount = snapshot.nodeClassNames.length;
  const classIndex = snapshot.nodeClassNames.indexOf(name);
  if (classIndex < 0) {
    return 0;
  }

  let count = 0;
  for (let position = 2; position < snapshot.nodes.length; position += 4) {
    const nodeClass = snapshot.nodes[position];
    if (nodeClass >= classCount) {
      throw new Error(
        'Unexpected heap snapshot encoding; class index out of bounds',
      );
    }
    if (nodeClass === classIndex) {
      count += 1;
    }
  }
  return count;
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
function collectGarbage(): void {
  Bun.gc(true);
  Bun.gc(true);
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
describe('bounded collector lazy allocation', () => {
  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
  it('does not retain typed-array buffers for combined collectors before append', () => {
    collectGarbage();
    const baseline = countHeapClass('Uint8Array');
    const budget = createByteBudget(BUDGET_BYTES);

    const collectors = Array.from(
      { length: COLLECTOR_COUNT },
      () => new BoundedCombinedCollector({ budget }),
    );
    collectGarbage();

    expect(collectors).toHaveLength(COLLECTOR_COUNT);
    expect(countHeapClass('Uint8Array') - baseline).toBeLessThanOrEqual(
      UINT8_ARRAY_GROWTH_THRESHOLD,
    );
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
  it('does not retain typed-array buffers for stream collectors before append', () => {
    collectGarbage();
    const baseline = countHeapClass('Uint8Array');
    const budget = createByteBudget(BUDGET_BYTES);

    const collectors = Array.from(
      { length: COLLECTOR_COUNT },
      () => new BoundedStreamCollector({ budget }),
    );
    collectGarbage();

    expect(collectors).toHaveLength(COLLECTOR_COUNT);
    expect(countHeapClass('Uint8Array') - baseline).toBeLessThanOrEqual(
      UINT8_ARRAY_GROWTH_THRESHOLD,
    );
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
  it('returns an empty combined result without an append', () => {
    const collector = new BoundedCombinedCollector({
      budget: createByteBudget(BUDGET_BYTES),
    });

    const result = collector.getResult();
    const raw = collector.getBoundedRawBuffer();

    expect(result.text).toBe('');
    expect(result.metadata).toMatchObject({
      observedBytes: 0,
      retainedBytes: 0,
      omittedBytes: 0,
      truncated: false,
    });
    expect(raw.byteLength).toBe(0);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
  it('returns an empty stream result without an append', () => {
    const collector = new BoundedStreamCollector({
      budget: createByteBudget(BUDGET_BYTES),
    });

    const result = collector.getResult();

    expect(result.text).toBe('');
    expect(result.metadata).toMatchObject({
      observedBytes: 0,
      retainedBytes: 0,
      omittedBytes: 0,
      truncated: false,
    });
    expect(collector.isTruncated).toBe(false);
    expect(collector.observedByteCount).toBe(0);
  });

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
  it('round-trips appended text through both collectors', () => {
    const budget = createByteBudget(BUDGET_BYTES);
    const combined = new BoundedCombinedCollector({ budget });
    const stream = new BoundedStreamCollector({ budget });

    combined.append('hi', 'stdout');
    stream.append('hi');

    expect(combined.getResult().text).toBe('hi');
    expect(stream.getResult().text).toBe('hi');
  });
});
