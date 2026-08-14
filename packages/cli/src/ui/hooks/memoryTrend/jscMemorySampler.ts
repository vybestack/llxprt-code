/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A memory sampler whose `heapUsed` is true under Bun.
 *
 * `process.memoryUsage()` is a Node-compatibility shim under Bun, and its
 * `heapUsed` field does not track the JavaScriptCore heap. Measured on bun
 * 1.3.14 against `bun:jsc`'s `heapSize()`:
 *
 *   objects   real JSC heap   reported heapUsed
 *   200 K            20 MB                0 MB
 *   1 M              98 MB               53 MB
 *   3 M             287 MB               53 MB
 *
 * The heap tripled while `heapUsed` sat still. That is not a scale factor to
 * correct for, it is a number that does not move, so any trend built on it is
 * meaningless — which is why a session could grow to many gigabytes while
 * `/perf` reported a small, flat heap.
 *
 * `rss` and `external` from the shim are sound and are passed through
 * unchanged; only `heapUsed`/`heapTotal` are re-sourced.
 *
 * LLxprt runs under Bun, so failure to load `bun:jsc` is a startup error rather
 * than a reason to silently fall back to the inaccurate compatibility value.
 *
 * TWO MEASURED PROPERTIES OF `heapStats()` THAT SHAPE THIS CODE
 *
 * 1. `extraMemorySize` must NOT be added to `heapSize`. It double-counts:
 *    retaining strings of a known logical size reported
 *    `heapSize == extraMemorySize == logicalBytes`, so summing them yields
 *    exactly 2x the truth.
 *
 * 2. `heapSize` lags allocation until a sweep. Sampled immediately after
 *    retaining 185 MB it read 67 MB; after `gcAndSweep()` it read 185 MB,
 *    matching the logical size exactly.
 *
 * This sampler deliberately does NOT force a collection. It runs on a 60 s UI
 * tick, and a full GC against a multi-gigabyte heap is a user-visible pause —
 * a monitor must not perturb what it observes. The consequence is that
 * `heapUsed` is a floor that trails recent allocation and converges after the
 * next natural collection, which is sound for the trend this feeds. Callers
 * wanting an exact instantaneous figure should collect first and read
 * `heapStats()` themselves.
 */

/** The subset of `bun:jsc` this module needs. */
interface JscHeapApi {
  heapSize: () => number;
  heapStats: () => { heapSize: number; heapCapacity: number };
}

/**
 * Bun populates `process.versions.bun`; Node leaves it undefined.
 *
 * Read through `globalThis` with optional chaining rather than touching
 * `process.versions` directly: this runs at module load, and suites that
 * substitute a partial `process` double would otherwise crash on import.
 * Mirrors the same defensive read in core's utils/runtime.ts.
 */
function isBunRuntime(): boolean {
  const versions = (
    globalThis as {
      process?: { versions?: Record<string, string | undefined> };
    }
  ).process?.versions;
  const bunVersion = versions?.bun;
  return typeof bunVersion === 'string' && bunVersion.length > 0;
}

function isJscHeapApi(value: unknown): value is JscHeapApi {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'heapSize' in value &&
    typeof value.heapSize === 'function' &&
    'heapStats' in value &&
    typeof value.heapStats === 'function'
  );
}

/** Loads the synchronous JavaScriptCore heap API required by this Bun CLI. */
function loadJscHeapApi(): JscHeapApi {
  if (!isBunRuntime()) {
    throw new Error('LLxprt memory sampling requires Bun');
  }
  const jsc = process.getBuiltinModule('bun:jsc');
  if (!isJscHeapApi(jsc)) {
    throw new Error('bun:jsc heap statistics are unavailable');
  }
  return jsc;
}

/**
 * Reads through `globalThis` rather than importing `node:process`. A memory
 * sampler must measure the real process, and sibling suites in this shard
 * replace the `node:process` module wholesale, which would otherwise make this
 * report another file's stub.
 */
function defaultBaseSampler(): NodeJS.MemoryUsage {
  const proc = (
    globalThis as { process?: { memoryUsage?: () => NodeJS.MemoryUsage } }
  ).process;
  if (typeof proc?.memoryUsage !== 'function') {
    throw new Error('process.memoryUsage is unavailable in this runtime');
  }
  return proc.memoryUsage();
}

/** Resolved once: the runtime does not change under a running process. */
const jscHeapApi = loadJscHeapApi();

/**
 * Samples process memory, correcting `heapUsed`/`heapTotal` from JavaScriptCore
 * when running under Bun.
 *
 * Shaped as `NodeJS.MemoryUsage` so it drops into the existing
 * `MemoryTelemetryControllerOptions.memoryNow` and `MemoryMonitorPorts.memoryUsage`
 * seams without changing either contract.
 */
export function sampleMemoryUsage(
  baseSampler: () => NodeJS.MemoryUsage = defaultBaseSampler,
): NodeJS.MemoryUsage {
  const base = baseSampler();
  const stats = jscHeapApi.heapStats();
  return {
    ...base,
    heapUsed: stats.heapSize,
    // JSC's capacity is the closest analogue to V8's committed heapTotal.
    heapTotal: Math.max(stats.heapCapacity, stats.heapSize),
  };
}
