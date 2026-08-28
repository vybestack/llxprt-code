/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * These tests inject the base sampler rather than reading ambient
 * `process.memoryUsage()`. Other suites in this shard mock `node:process`
 * module-wide (bugCommand.test.ts substitutes `memoryUsage: () => ({ rss: 0 })`),
 * so an ambient read here would assert against another file's mock. Injection
 * keeps these deterministic regardless of sibling suites.
 */

import { describe, expect, it } from 'bun:test';
import { sampleMemoryUsage } from './jscMemorySampler.js';

/** A recognisable base sample so pass-through is provable. */
const BASE: NodeJS.MemoryUsage = {
  rss: 111_000_000,
  heapTotal: 222_000,
  heapUsed: 333_000,
  external: 444_000,
  arrayBuffers: 555_000,
};

const base = () => ({ ...BASE });

interface JscHeapSizeApi {
  heapSize: () => number;
}

interface JscTestApi extends JscHeapSizeApi {
  heapStats: () => {
    heapSize: number;
    heapCapacity: number;
    extraMemorySize: number;
  };
}

interface JscStatsTestApi extends JscTestApi {
  gcAndSweep: () => void;
}

function isJscHeapSizeApi(value: unknown): value is JscHeapSizeApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'heapSize' in value &&
    typeof value.heapSize === 'function'
  );
}

function isJscTestApi(value: unknown): value is JscTestApi {
  return (
    isJscHeapSizeApi(value) &&
    'heapStats' in value &&
    typeof value.heapStats === 'function'
  );
}

function isJscStatsTestApi(value: unknown): value is JscStatsTestApi {
  return (
    isJscTestApi(value) &&
    'gcAndSweep' in value &&
    typeof value.gcAndSweep === 'function'
  );
}

/** Reads the JSC heap directly, defensively in case `process` is a double. */
function jscHeapSize(): number | null {
  const getBuiltinModule = (
    globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
  ).process?.getBuiltinModule;
  if (typeof getBuiltinModule !== 'function') {
    return null;
  }
  const jsc = getBuiltinModule('bun:jsc');
  return isJscHeapSizeApi(jsc) ? jsc.heapSize() : null;
}

const jscAvailable = jscHeapSize() !== null;

describe('sampleMemoryUsage', () => {
  it('returns a complete NodeJS.MemoryUsage shape', () => {
    const sample = sampleMemoryUsage(base);
    expect(typeof sample.rss).toBe('number');
    expect(typeof sample.heapUsed).toBe('number');
    expect(typeof sample.heapTotal).toBe('number');
    expect(typeof sample.external).toBe('number');
    expect(typeof sample.arrayBuffers).toBe('number');
  });

  it('passes rss, external and arrayBuffers through untouched', () => {
    const sample = sampleMemoryUsage(base);
    expect(sample.rss).toBe(BASE.rss);
    expect(sample.external).toBe(BASE.external);
    expect(sample.arrayBuffers).toBe(BASE.arrayBuffers);
  });

  it('keeps heapTotal at or above heapUsed', () => {
    const sample = sampleMemoryUsage(base);
    expect(sample.heapTotal).toBeGreaterThanOrEqual(sample.heapUsed);
  });

  it('defaults to the platform sampler when no base is injected', () => {
    // Only the shape is asserted: the ambient value may come from a sibling
    // suite's module mock, which is not this module's concern.
    const sample = sampleMemoryUsage();
    expect(typeof sample.rss).toBe('number');
    expect(typeof sample.heapUsed).toBe('number');
  });
});

describe('heapUsed correctness', () => {
  it.skipIf(!jscAvailable)(
    'replaces the base heapUsed with the real JSC heap size',
    () => {
      const sample = sampleMemoryUsage(base);
      // The whole point: the incoming heapUsed must NOT survive.
      expect(sample.heapUsed).not.toBe(BASE.heapUsed);
      const truth = jscHeapSize();
      expect(truth).not.toBeNull();
      expect(
        Math.abs(sample.heapUsed - (truth as number)) / (truth as number),
      ).toBeLessThan(0.05);
    },
  );

  it.skipIf(!jscAvailable)(
    'samples the JSC heap when full heap statistics are unavailable',
    () => {
      const jsc = globalThis.process.getBuiltinModule('bun:jsc');
      if (!isJscTestApi(jsc)) {
        throw new Error('bun:jsc test API is unavailable');
      }
      const expectedHeapSize = jsc.heapSize();
      const originalHeapStats = jsc.heapStats;
      jsc.heapStats = () => {
        throw new Error('full heap enumeration must not run during sampling');
      };

      try {
        const sample = sampleMemoryUsage(base);
        expect(
          Math.abs(sample.heapUsed - expectedHeapSize) / expectedHeapSize,
        ).toBeLessThan(0.05);
      } finally {
        jsc.heapStats = originalHeapStats;
      }
    },
  );

  it.skipIf(!jscAvailable)(
    'does not add extraMemorySize, which double-counts string backing stores',
    () => {
      const jsc = (
        globalThis as {
          process: { getBuiltinModule: (id: string) => unknown };
        }
      ).process.getBuiltinModule('bun:jsc');
      if (!isJscStatsTestApi(jsc)) {
        throw new Error('bun:jsc heap statistics test API is unavailable');
      }

      // Deltas, not absolutes: sibling suites share this heap.
      jsc.gcAndSweep();
      const before = jsc.heapStats();

      const retained: string[] = [];
      for (let i = 0; i < 1500; i++) {
        const s = `blob-${i}-`.repeat(4000);
        s.charCodeAt(s.length - 1);
        retained.push(s);
      }
      const logicalBytes = retained.reduce((n, s) => n + s.length, 0);

      jsc.gcAndSweep();
      const after = jsc.heapStats();

      const heapDelta = after.heapSize - before.heapSize;
      const summedDelta =
        after.heapSize +
        after.extraMemorySize -
        (before.heapSize + before.extraMemorySize);

      // heapSize alone accounts for the payload about once...
      expect(heapDelta).toBeGreaterThan(logicalBytes * 0.8);
      expect(heapDelta).toBeLessThan(logicalBytes * 1.3);
      // ...while heapSize + extraMemorySize counts it about twice, which is why
      // the sampler must not sum them.
      expect(summedDelta).toBeGreaterThan(logicalBytes * 1.7);
      expect(retained).toHaveLength(1500);
    },
  );

  it.skipIf(!jscAvailable)('tracks a large retained allocation', () => {
    const jsc = (
      globalThis as { process: { getBuiltinModule: (id: string) => unknown } }
    ).process.getBuiltinModule('bun:jsc') as { gcAndSweep: () => void };

    jsc.gcAndSweep();
    const before = sampleMemoryUsage(base).heapUsed;

    // Touched so they flatten rather than remaining lazy ropes.
    const retained: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const s = `payload-${i}-`.repeat(2000);
      s.charCodeAt(s.length - 1);
      retained.push(s);
    }
    const logicalBytes = retained.reduce((n, s) => n + s.length, 0);

    jsc.gcAndSweep();
    const growth = sampleMemoryUsage(base).heapUsed - before;

    expect(growth).toBeGreaterThan(logicalBytes * 0.5);
    expect(retained).toHaveLength(3000);
  });
});
