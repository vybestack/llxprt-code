/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so hook state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P10 behavioral tests for useMemoryMonitor (EVIDENCE-AC11).
 *
 * Tests the extended 60 s interval: warn-once latch is separated from the
 * sampling loop (DEFECT 1 fix — the interval no longer clearInterval's itself
 * after warning). No new timer is created. When a memory controller is present,
 * each tick records a sample; when absent, warn-only behavior is retained.
 *
 * Uses package-private timer/memory ports for deterministic behavior. No mock
 * theatre — real hook lifecycle via renderHook, real MemoryTelemetryController
 * with a real PerfSink.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { renderHook } from '../../../test-utils/render.js';
import type { HistoryItemWithoutId } from '../../types.js';
import {
  useMemoryMonitor,
  __setMemoryMonitorPortsForTesting,
  __getRealMemoryMonitorPortsForTesting,
  type MemoryMonitorPorts,
} from '../useMemoryMonitor.js';
import { MemoryTelemetryController } from './memoryTelemetry.js';
import { PerfSink } from '@vybestack/llxprt-code-telemetry/perf/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let dir: string;
const activeControllers: MemoryTelemetryController[] = [];
const activeSinks: PerfSink[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usememmon-'));
  activeControllers.length = 0;
  activeSinks.length = 0;
});

afterEach(async () => {
  __setMemoryMonitorPortsForTesting(null);
  const errors: unknown[] = [];
  for (const controller of activeControllers) {
    try {
      await controller.drain();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const sink of activeSinks) {
    try {
      await sink.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  activeControllers.length = 0;
  activeSinks.length = 0;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'memory monitor test cleanup failed');
  }
});

function fixtureMemory(rss: number): NodeJS.MemoryUsage {
  return {
    rss,
    heapUsed: rss + 1000,
    external: rss + 2000,
    arrayBuffers: rss + 3000,
    heapTotal: rss + 5000,
  } as NodeJS.MemoryUsage;
}

/**
 * Controllable interval: stores the handler so tests can fire it
 * deterministically, and counts setInterval/clearInterval calls.
 */
function makeControllablePorts(
  memoryUsage: () => NodeJS.MemoryUsage,
): MemoryMonitorPorts & {
  fireTick: () => void;
  intervalCount: () => number;
  clearCount: () => number;
  isCleared: () => boolean;
} {
  let handler: (() => void) | null = null;
  let intervals = 0;
  let clears = 0;
  return {
    setInterval: (h: () => void, _ms: number) => {
      intervals += 1;
      handler = h;
      return intervals; // unique id
    },
    clearInterval: () => {
      clears += 1;
      handler = null;
    },
    memoryUsage,
    rssBytes: () => memoryUsage().rss,
    retainedHeapBytes: () => memoryUsage().heapUsed,
    fireTick: () => {
      if (handler !== null) handler();
    },
    intervalCount: () => intervals,
    clearCount: () => clears,
    isCleared: () => handler === null,
  };
}

function makeCapturingAddItem(): {
  addItem: (item: HistoryItemWithoutId, ts: number) => void;
  texts: () => readonly string[];
} {
  const texts: string[] = [];
  return {
    addItem: (item: HistoryItemWithoutId) => {
      const text = (item as { text?: unknown }).text;
      texts.push(typeof text === 'string' ? text : '');
    },
    texts: () => texts,
  };
}

function makeAddItem(): {
  addItem: (item: HistoryItemWithoutId, ts: number) => void;
  calls: () => number;
} {
  let calls = 0;
  return {
    addItem: () => {
      calls += 1;
    },
    calls: () => calls,
  };
}

describe('useMemoryMonitor — one interval, no new timers (AC-11)', () => {
  it('creates exactly one interval on mount', () => {
    const ports = makeControllablePorts(() => fixtureMemory(1000));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem } = makeAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    expect(ports.intervalCount()).toBe(1);
    unmount();
  });

  it('clears the interval on unmount', () => {
    const ports = makeControllablePorts(() => fixtureMemory(1000));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem } = makeAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    expect(ports.clearCount()).toBe(0);
    unmount();
    expect(ports.clearCount()).toBe(1);
  });
});

describe('useMemoryMonitor — warn-once latch separated from sampling (AC-11)', () => {
  it('fires warning once but interval continues (DEFECT 1 fix)', () => {
    const ports = makeControllablePorts(() =>
      fixtureMemory(8 * 1024 * 1024 * 1024),
    );
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, calls: warningCalls } = makeAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));

    // Tick 1: fires warning (rss > 7GB threshold)
    ports.fireTick();
    expect(warningCalls()).toBe(1);
    // Interval is STILL active — not cleared.
    expect(ports.isCleared()).toBe(false);

    // Tick 2: warning NOT repeated (latch), but interval still running.
    ports.fireTick();
    expect(warningCalls()).toBe(1);
    expect(ports.isCleared()).toBe(false);

    // Tick 3: still running.
    ports.fireTick();
    expect(warningCalls()).toBe(1);
    expect(ports.isCleared()).toBe(false);

    unmount();
  });

  it('does not fire warning when rss is below threshold', () => {
    const ports = makeControllablePorts(() => fixtureMemory(1_000_000));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, calls: warningCalls } = makeAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    ports.fireTick();
    ports.fireTick();
    ports.fireTick();
    expect(warningCalls()).toBe(0);
    expect(ports.isCleared()).toBe(false);
    unmount();
  });
});

describe('useMemoryMonitor — memory off (no controller) retains warn-only (AC-10)', () => {
  it('without controller, warn-only behavior is retained', () => {
    const ports = makeControllablePorts(() => fixtureMemory(1000));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, calls: warningCalls } = makeAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    ports.fireTick();
    ports.fireTick();
    expect(warningCalls()).toBe(0);
    expect(ports.isCleared()).toBe(false);
    expect(ports.intervalCount()).toBe(1);
    unmount();
  });
});

describe('useMemoryMonitor — memory on records tick samples (AC-10)', () => {
  it('with controller, each tick records a sample to the ring', () => {
    let rss = 10_000_000;
    const ports = makeControllablePorts(() => fixtureMemory(rss));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem } = makeAddItem();

    const sink = new PerfSink({ dir, runUuid: crypto.randomUUID() });
    const controller = new MemoryTelemetryController({
      sink,
      monotonicNow: () => 0,
      memoryNow: () => fixtureMemory(rss),
    });
    activeSinks.push(sink);
    activeControllers.push(controller);

    const { unmount } = renderHook(() =>
      useMemoryMonitor({ addItem, memoryController: controller }),
    );

    rss = 20_000_000;
    ports.fireTick();
    rss = 30_000_000;
    ports.fireTick();

    const snap = controller.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].rss).toBe(20_000_000);
    expect(snap[1].rss).toBe(30_000_000);

    unmount();
  });
});

describe('useMemoryMonitor — disabled path uses rss() not full memoryUsage (P12)', () => {
  it('without controller, tick calls rssBytes() not full memoryUsage()', () => {
    let fullCalls = 0;
    let rssCalls = 0;
    const handler: { current: (() => void) | null } = { current: null };
    const ports: MemoryMonitorPorts = {
      setInterval: (h: () => void, _ms: number) => {
        handler.current = h;
        return 1;
      },
      clearInterval: () => {
        handler.current = null;
      },
      memoryUsage: () => {
        fullCalls++;
        return fixtureMemory(1000);
      },
      rssBytes: () => {
        rssCalls++;
        return 1000;
      },
      retainedHeapBytes: () => 0,
    };
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem } = makeAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    // The hook mounted and setInterval captured the handler.
    handler.current?.();

    expect(rssCalls).toBe(1);
    expect(fullCalls).toBe(0);

    unmount();
  });

  it('with controller, tick calls full memoryUsage() exactly once per tick', () => {
    let fullCalls = 0;
    let rssCalls = 0;
    const handler: { current: (() => void) | null } = { current: null };
    const ports: MemoryMonitorPorts = {
      setInterval: (h: () => void, _ms: number) => {
        handler.current = h;
        return 1;
      },
      clearInterval: () => {
        handler.current = null;
      },
      memoryUsage: () => {
        fullCalls++;
        return fixtureMemory(10_000_000);
      },
      rssBytes: () => {
        rssCalls++;
        return 10_000_000;
      },
      retainedHeapBytes: () => 0,
    };
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem } = makeAddItem();
    const sink = new PerfSink({ dir, runUuid: crypto.randomUUID() });
    const controller = new MemoryTelemetryController({
      sink,
      monotonicNow: () => 0,
      memoryNow: () => fixtureMemory(10_000_000),
    });
    activeSinks.push(sink);
    activeControllers.push(controller);

    const { unmount } = renderHook(() =>
      useMemoryMonitor({ addItem, memoryController: controller }),
    );

    handler.current?.();
    // Enabled tick: exactly one full memoryUsage call, zero rssBytes calls.
    expect(fullCalls).toBe(1);
    expect(rssCalls).toBe(0);

    unmount();
  });

  describe('useMemoryMonitor — real default disabled port (P12)', () => {
    it('the real production default rssBytes calls process.memoryUsage.rss(), not process.memoryUsage().rss', () => {
      // Prove the real default disabled path uses the cheap rss accessor
      // (process.memoryUsage.rss()) rather than allocating a full MemoryUsage
      // object (process.memoryUsage().rss). Spies on both the .rss accessor
      // and the full memoryUsage call on a wrapper that preserves .rss.
      const origMu = process.memoryUsage;
      try {
        let rssCalls = 0;
        let fullCalls = 0;
        const wrapper = function memoryUsage(): NodeJS.MemoryUsage {
          fullCalls += 1;
          return origMu.call(process);
        } as typeof process.memoryUsage;
        (wrapper as unknown as { rss: () => number }).rss =
          function rss(): number {
            rssCalls += 1;
            return 99_999;
          };
        (
          process as unknown as { memoryUsage: typeof process.memoryUsage }
        ).memoryUsage = wrapper;

        const real = __getRealMemoryMonitorPortsForTesting();
        const result = real.rssBytes();

        expect(rssCalls).toBe(1);
        expect(fullCalls).toBe(0);
        expect(result).toBe(99_999);
      } finally {
        (
          process as unknown as { memoryUsage: typeof process.memoryUsage }
        ).memoryUsage = origMu;
      }
    });

    it('the real production default memoryUsage calls process.memoryUsage() (controller-enabled tick)', () => {
      const origMu = process.memoryUsage;
      try {
        let fullCalls = 0;
        const wrapper = function memoryUsage(): NodeJS.MemoryUsage {
          fullCalls += 1;
          return origMu.call(process);
        } as typeof process.memoryUsage;
        (
          process as unknown as { memoryUsage: typeof process.memoryUsage }
        ).memoryUsage = wrapper;

        const real = __getRealMemoryMonitorPortsForTesting();
        real.memoryUsage();

        expect(fullCalls).toBe(1);
      } finally {
        (
          process as unknown as { memoryUsage: typeof process.memoryUsage }
        ).memoryUsage = origMu;
      }
    });
  });
});

/**
 * Resident memory is a high-water mark: measured on Bun 1.3.14 (darwin-arm64),
 * releasing 200 MB of strings returns `heapSize` to baseline while RSS stays at
 * its peak. A warning that reports only RSS therefore describes a past peak as
 * though it were current usage. The warning must report retained JS heap too,
 * so the reader can tell accumulation apart from a one-time spike.
 */
describe('useMemoryMonitor — high-memory warning distinguishes peak from retained', () => {
  const EIGHT_POINT_FOUR_GB = 9_018_355_814;
  const RETAINED_HEAP = 1_288_490_188;

  it('reports both resident memory and retained JS heap in the warning', () => {
    const ports = makeControllablePorts(() => ({
      rss: EIGHT_POINT_FOUR_GB,
      heapUsed: RETAINED_HEAP,
      heapTotal: RETAINED_HEAP,
      external: 0,
      arrayBuffers: 0,
    }));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, texts } = makeCapturingAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    ports.fireTick();

    expect(texts()).toHaveLength(1);
    const warning = texts()[0] ?? '';
    // 9_018_355_814 / 1024^3 = 8.40 GB resident.
    expect(warning).toContain('8.40 GB');
    // 1_288_490_188 / 1024^3 = 1.20 GB retained.
    expect(warning).toContain('1.20 GB');
    expect(warning).toContain('/bug');

    unmount();
  });

  it('describes resident memory as a peak that may not shrink', () => {
    const ports = makeControllablePorts(() => ({
      rss: EIGHT_POINT_FOUR_GB,
      heapUsed: RETAINED_HEAP,
      heapTotal: RETAINED_HEAP,
      external: 0,
      arrayBuffers: 0,
    }));
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, texts } = makeCapturingAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));
    ports.fireTick();

    const warning = texts()[0] ?? '';
    expect(warning.toLowerCase()).toContain('peak');
    expect(warning.toLowerCase()).toContain('retained');

    unmount();
  });

  it('keeps every tick on the cheap accessors and never takes a full reading', () => {
    let fullCalls = 0;
    let rssCalls = 0;
    let heapCalls = 0;
    let rss = 1_000_000;
    const handler: { current: (() => void) | null } = { current: null };
    const ports: MemoryMonitorPorts = {
      setInterval: (h: () => void, _ms: number) => {
        handler.current = h;
        return 1;
      },
      clearInterval: () => {
        handler.current = null;
      },
      memoryUsage: () => {
        fullCalls += 1;
        return {
          rss,
          heapUsed: RETAINED_HEAP,
          heapTotal: RETAINED_HEAP,
          external: 0,
          arrayBuffers: 0,
        };
      },
      rssBytes: () => {
        rssCalls += 1;
        return rss;
      },
      retainedHeapBytes: () => {
        heapCalls += 1;
        return RETAINED_HEAP;
      },
    };
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, texts } = makeCapturingAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));

    // Below threshold: cheap RSS accessor only, no heap read, no full sample.
    handler.current?.();
    handler.current?.();
    expect(rssCalls).toBe(2);
    expect(heapCalls).toBe(0);
    expect(texts()).toHaveLength(0);

    // Crossing the threshold reads the retained heap, still not a full sample.
    rss = EIGHT_POINT_FOUR_GB;
    handler.current?.();
    expect(texts()).toHaveLength(1);
    expect(rssCalls).toBe(3);
    expect(heapCalls).toBe(1);
    // A full MemoryUsage object is never allocated on the disabled path.
    expect(fullCalls).toBe(0);

    unmount();
  });

  it('stays on the cheap path for every tick after the warning', () => {
    let fullCalls = 0;
    let rssCalls = 0;
    let heapCalls = 0;
    const handler: { current: (() => void) | null } = { current: null };
    const ports: MemoryMonitorPorts = {
      setInterval: (h: () => void, _ms: number) => {
        handler.current = h;
        return 1;
      },
      clearInterval: () => {
        handler.current = null;
      },
      memoryUsage: () => {
        fullCalls += 1;
        return {
          rss: EIGHT_POINT_FOUR_GB,
          heapUsed: RETAINED_HEAP,
          heapTotal: RETAINED_HEAP,
          external: 0,
          arrayBuffers: 0,
        };
      },
      rssBytes: () => {
        rssCalls += 1;
        return EIGHT_POINT_FOUR_GB;
      },
      retainedHeapBytes: () => {
        heapCalls += 1;
        return RETAINED_HEAP;
      },
    };
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, texts } = makeCapturingAddItem();

    const { unmount } = renderHook(() => useMemoryMonitor({ addItem }));

    // Five ticks all above the threshold.
    handler.current?.();
    handler.current?.();
    handler.current?.();
    handler.current?.();
    handler.current?.();

    // The warning fires once and reads the heap once, while the interval keeps
    // sampling RSS on every tick and never allocates a full MemoryUsage.
    expect(texts()).toHaveLength(1);
    expect(heapCalls).toBe(1);
    expect(rssCalls).toBe(5);
    expect(fullCalls).toBe(0);

    unmount();
  });

  it('takes one full reading per tick when telemetry is enabled', () => {
    let fullCalls = 0;
    const sample: NodeJS.MemoryUsage = {
      rss: EIGHT_POINT_FOUR_GB,
      heapUsed: RETAINED_HEAP,
      heapTotal: RETAINED_HEAP,
      external: 0,
      arrayBuffers: 0,
    };
    const handler: { current: (() => void) | null } = { current: null };
    const ports: MemoryMonitorPorts = {
      setInterval: (h: () => void, _ms: number) => {
        handler.current = h;
        return 1;
      },
      clearInterval: () => {
        handler.current = null;
      },
      memoryUsage: () => {
        fullCalls += 1;
        return sample;
      },
      rssBytes: () => sample.rss,
      retainedHeapBytes: () => sample.heapUsed,
    };
    __setMemoryMonitorPortsForTesting(ports);
    const { addItem, texts } = makeCapturingAddItem();

    const sink = new PerfSink({ dir, runUuid: crypto.randomUUID() });
    const controller = new MemoryTelemetryController({
      sink,
      monotonicNow: () => 0,
      memoryNow: () => sample,
    });
    activeSinks.push(sink);
    activeControllers.push(controller);

    const { unmount } = renderHook(() =>
      useMemoryMonitor({ addItem, memoryController: controller }),
    );

    handler.current?.();

    expect(texts()).toHaveLength(1);
    expect(texts()[0] ?? '').toContain('1.20 GB');
    // The tick's own reading, and the warning does not trigger another.
    expect(fullCalls).toBe(1);

    unmount();
  });
});
