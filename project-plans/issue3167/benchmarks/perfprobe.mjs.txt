// Read-only capability + cost probe for client-perf instrumentation design.
const isBun = typeof globalThis.Bun !== 'undefined';
const out = {};
out.runtime = isBun ? 'bun ' + Bun.version : 'node ' + process.version;

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
  for (let i = 0; i < N; i++) { counters[0] += 1; counters[1] += i & 7; }
  const t1 = performance.now();
  out.counterIncrement = { nsPerCall: +(((t1 - t0) * 1e6) / N).toFixed(2) };
}

// --- 3. process.memoryUsage() cost + rss() variant ---
{
  const N = 2000;
  let t0 = performance.now();
  for (let i = 0; i < N; i++) process.memoryUsage();
  let t1 = performance.now();
  out.memoryUsage = { usPerCall: +(((t1 - t0) * 1000) / N).toFixed(2), keys: Object.keys(process.memoryUsage()) };
  if (typeof process.memoryUsage.rss === 'function') {
    t0 = performance.now();
    for (let i = 0; i < N; i++) process.memoryUsage.rss();
    t1 = performance.now();
    out.memoryUsageRss = { available: true, usPerCall: +(((t1 - t0) * 1000) / N).toFixed(2) };
  } else {
    out.memoryUsageRss = { available: false };
  }
}

// --- 4. perf_hooks: monitorEventLoopDelay + PerformanceObserver(gc) ---
{
  const ph = await import('node:perf_hooks');
  out.perfHooks = {
    exports: Object.keys(ph).sort(),
    monitorEventLoopDelayType: typeof ph.monitorEventLoopDelay,
    performanceObserverType: typeof ph.PerformanceObserver,
    supportedEntryTypes: ph.PerformanceObserver && ph.PerformanceObserver.supportedEntryTypes
      ? Array.from(ph.PerformanceObserver.supportedEntryTypes)
      : null,
  };
  if (typeof ph.monitorEventLoopDelay === 'function') {
    try {
      const h = ph.monitorEventLoopDelay({ resolution: 10 });
      h.enable();
      await new Promise((r) => setTimeout(r, 250));
      h.disable();
      out.perfHooks.eventLoopHistogram = {
        works: true, min: h.min, mean: Math.round(h.mean), p99: h.percentile(99), exceeds: h.exceeds,
      };
    } catch (e) {
      out.perfHooks.eventLoopHistogram = { works: false, error: String(e).slice(0, 160) };
    }
  } else {
    out.perfHooks.eventLoopHistogram = { works: false, error: 'monitorEventLoopDelay not a function' };
  }
  // GC observation
  if (typeof ph.PerformanceObserver === 'function') {
    try {
      let gcEntries = 0;
      const obs = new ph.PerformanceObserver((list) => { gcEntries += list.getEntries().length; });
      obs.observe({ entryTypes: ['gc'] });
      // create garbage
      let junk = [];
      for (let i = 0; i < 400000; i++) { junk.push({ a: i, b: 'x'.repeat(8) }); if (junk.length > 50000) junk = []; }
      await new Promise((r) => setTimeout(r, 200));
      obs.disconnect();
      out.gcObserver = { observeAccepted: true, entriesSeen: gcEntries };
    } catch (e) {
      out.gcObserver = { observeAccepted: false, error: String(e).slice(0, 200) };
    }
  }
}

// --- 5. self-scheduled event-loop drift probe (the portable fallback) ---
{
  const samples = [];
  const INTERVAL = 50;
  await new Promise((resolve) => {
    let last = performance.now();
    let n = 0;
    const id = setInterval(() => {
      const now = performance.now();
      samples.push(now - last - INTERVAL);
      last = now;
      if (++n >= 10) { clearInterval(id); resolve(); }
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
  const orig = process.stdout.write;
  let bytes = 0, calls = 0;
  process.stdout.write = function (chunk, ...rest) {
    calls++;
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    return orig.call(this, chunk, ...rest);
  };
  process.stdout.write('');
  process.stdout.write('\u001b[2Kprobe\n');
  process.stdout.write = orig;
  out.stdoutIntercept = { patchable: true, calls, bytes };
}

// --- 7. heap stats availability (v8 vs JSC) ---
{
  try {
    const v8 = await import('node:v8');
    const s = v8.getHeapStatistics();
    out.heapStatistics = { available: true, heapSizeLimit: s.heap_size_limit, usedHeapSize: s.used_heap_size };
  } catch (e) {
    out.heapStatistics = { available: false, error: String(e).slice(0, 120) };
  }
  out.bunGcAvailable = isBun && typeof Bun.gc === 'function';
  out.globalGcAvailable = typeof globalThis.gc === 'function';
}

console.error(JSON.stringify(out, null, 2));
