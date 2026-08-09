#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Read-only capability + cost probe for client-perf instrumentation design.
const bunRuntime = globalThis.Bun;
const isBun = typeof bunRuntime !== 'undefined';
const out: Record<string, unknown> = {};
out.runtime = isBun ? `bun ${bunRuntime.version}` : `node ${process.version}`;

// --- 1. performance.now() availability + cost ---
{
  const N = 2_000_000;
  // warmup
  for (let i = 0; i < 100000; i++) performance.now();
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < N; i++) sink += performance.now();
  const t1 = performance.now();
  out.performanceNow = {
    available: typeof performance.now === 'function',
    nsPerCall: +(((t1 - t0) * 1e6) / N).toFixed(1),
    sinkNonZero: sink > 0,
  };
}

// --- 2. baseline: cost of a plain counter increment (the "free" claim) ---
{
  const N = 2_000_000;
  const counters = new Float64Array(8);
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    counters[0] += 1;
    counters[1] += i & 7;
  }
  const t1 = performance.now();
  out.counterIncrement = {
    nsPerCall: +(((t1 - t0) * 1e6) / N).toFixed(2),
  };
}

// --- 3. process.memoryUsage() cost + rss() variant ---
{
  const N = 2000;
  const memoryUsageFn = process.memoryUsage as typeof process.memoryUsage & {
    rss?: () => number;
  };
  let t0 = performance.now();
  for (let i = 0; i < N; i++) process.memoryUsage();
  let t1 = performance.now();
  out.memoryUsage = {
    usPerCall: +(((t1 - t0) * 1000) / N).toFixed(2),
    keys: Object.keys(process.memoryUsage()),
  };
  if (typeof memoryUsageFn.rss === 'function') {
    t0 = performance.now();
    for (let i = 0; i < N; i++) memoryUsageFn.rss();
    t1 = performance.now();
    out.memoryUsageRss = {
      available: true,
      usPerCall: +(((t1 - t0) * 1000) / N).toFixed(2),
    };
  } else {
    out.memoryUsageRss = { available: false };
  }
}

// --- 4. perf_hooks: monitorEventLoopDelay + PerformanceObserver(gc) ---
{
  const ph = await import('node:perf_hooks');
  // bun-types' PerformanceObserver omits the static `supportedEntryTypes`
  // member that @types/node declares; widen so the runtime probe type-checks.
  const PerformanceObserverCtor = ph.PerformanceObserver as (
    | (typeof ph.PerformanceObserver & {
        supportedEntryTypes?: readonly string[];
      })
    | undefined
  );
  const perfHooksResult: Record<string, unknown> = {
    exports: Object.keys(ph).sort(),
    monitorEventLoopDelayType: typeof ph.monitorEventLoopDelay,
    performanceObserverType: typeof ph.PerformanceObserver,
    supportedEntryTypes:
      PerformanceObserverCtor && PerformanceObserverCtor.supportedEntryTypes
        ? Array.from(PerformanceObserverCtor.supportedEntryTypes)
        : null,
  };
  if (typeof ph.monitorEventLoopDelay === 'function') {
    try {
      const h = ph.monitorEventLoopDelay({ resolution: 10 });
      h.enable();
      await new Promise((r) => setTimeout(r, 250));
      h.disable();
      perfHooksResult.eventLoopHistogram = {
        works: true,
        min: h.min,
        mean: Math.round(h.mean),
        p99: h.percentile(99),
        exceeds: h.exceeds,
      };
    } catch (e) {
      perfHooksResult.eventLoopHistogram = {
        works: false,
        error: String(e).slice(0, 160),
      };
    }
  } else {
    perfHooksResult.eventLoopHistogram = {
      works: false,
      error: 'monitorEventLoopDelay not a function',
    };
  }
  // GC observation
  if (typeof ph.PerformanceObserver === 'function') {
    try {
      let gcEntries = 0;
      const obs = new ph.PerformanceObserver((list) => {
        gcEntries += list.getEntries().length;
      });
      obs.observe({ entryTypes: ['gc'] });
      // create garbage
      let junk: { a: number; b: string }[] = [];
      for (let i = 0; i < 400000; i++) {
        junk.push({ a: i, b: 'x'.repeat(8) });
        if (junk.length > 50000) junk = [];
      }
      await new Promise((r) => setTimeout(r, 200));
      obs.disconnect();
      out.gcObserver = { observeAccepted: true, entriesSeen: gcEntries };
    } catch (e) {
      out.gcObserver = { observeAccepted: false, error: String(e).slice(0, 200) };
    }
  }
  out.perfHooks = perfHooksResult;
}

// --- 5. self-scheduled event-loop drift probe (the portable fallback) ---
{
  const samples: number[] = [];
  const INTERVAL = 50;
  await new Promise<void>((resolve) => {
    let last = performance.now();
    let n = 0;
    const id = setInterval(() => {
      const now = performance.now();
      samples.push(now - last - INTERVAL);
      last = now;
      if (++n >= 10) {
        clearInterval(id);
        resolve();
      }
    }, INTERVAL);
  });
  samples.sort((a, b) => a - b);
  out.driftProbe = {
    works: samples.length === 10,
    medianDriftMs: +samples[5].toFixed(2),
    maxDriftMs: +samples[samples.length - 1].toFixed(2),
  };
}

// --- 6. stdout write interception feasibility (for ANSI byte counting) ---
{
  const origWrite = process.stdout.write.bind(process.stdout);
  let bytes = 0;
  let calls = 0;
  const forward = origWrite as (
    chunk: Uint8Array | string,
    ...rest: unknown[]
  ) => boolean;
  process.stdout.write = ((
    chunk: Uint8Array | string,
    ...rest: unknown[]
  ): boolean => {
    calls++;
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    return forward(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stdout.write('');
  process.stdout.write('\u001b[2Kprobe\n');
  process.stdout.write = origWrite as typeof process.stdout.write;
  out.stdoutIntercept = { patchable: true, calls, bytes };
}

// --- 7. heap stats availability (v8 vs JSC) ---
{
  try {
    const v8 = await import('node:v8');
    const s = v8.getHeapStatistics();
    out.heapStatistics = {
      available: true,
      heapSizeLimit: s.heap_size_limit,
      usedHeapSize: s.used_heap_size,
    };
  } catch (e) {
    out.heapStatistics = { available: false, error: String(e).slice(0, 120) };
  }
  out.bunGcAvailable = isBun && typeof bunRuntime.gc === 'function';
  out.globalGcAvailable =
    typeof (globalThis as { gc?: unknown }).gc === 'function';
}

console.error(JSON.stringify(out, null, 2));
