/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import process from 'node:process';
import { MessageType, type HistoryItemWithoutId } from '../types.js';
import type { MemoryTelemetryController } from './memoryTrend/memoryTelemetry.js';
import { sampleMemoryUsage } from './memoryTrend/jscMemorySampler.js';

export const MEMORY_WARNING_THRESHOLD_BYTES = 7 * 1024 * 1024 * 1024; // 7GB
export const MEMORY_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * Package-private ports for deterministic testing. The real implementation
 * uses `globalThis.setInterval` / `globalThis.clearInterval` /
 * `process.memoryUsage`. Tests inject a controllable scheduler and memory
 * function via {@link __setMemoryMonitorPortsForTesting}.
 */
export interface MemoryMonitorPorts {
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  memoryUsage: () => NodeJS.MemoryUsage;
  /**
   * Cheaper RSS-only sampler used on the disabled (no controller) path so the
   * warning check avoids allocating a full MemoryUsage object every tick.
   * Defaults to process.memoryUsage.rss().
   */
  rssBytes: () => number;
}

const realPorts: MemoryMonitorPorts = {
  setInterval: (h, ms) => globalThis.setInterval(h, ms),
  clearInterval: (id) =>
    globalThis.clearInterval(id as ReturnType<typeof setInterval>),
  // JSC-corrected: under Bun the platform `heapUsed` does not track the real
  // heap (see jscMemorySampler.ts). `rss` is sound either way, so the cheap
  // warning-only path below still reads it directly.
  memoryUsage: () => sampleMemoryUsage(),
  rssBytes: () => process.memoryUsage.rss(),
};

let __portsForTesting: MemoryMonitorPorts | null = null;

/**
 * Package-private test seam. Inject controllable ports for deterministic
 * timer/memory behavior, or pass `null` to restore the real ports.
 */
export function __setMemoryMonitorPortsForTesting(
  ports: MemoryMonitorPorts | null,
): void {
  __portsForTesting = ports;
}

/**
 * Package-private test seam exposing the real production default ports so
 * tests can assert behavior of the actual default (e.g. that `rssBytes` uses
 * the cheap `process.memoryUsage.rss()` rather than the full object).
 */
export function __getRealMemoryMonitorPortsForTesting(): MemoryMonitorPorts {
  return realPorts;
}

export interface UseMemoryMonitorOptions {
  addItem: (item: HistoryItemWithoutId, timestamp: number) => void;
  /**
   * Optional memory telemetry controller. When present (perf+memory enabled),
   * each 60 s tick records the full memory sample to the ring and writes a
   * `memory_sample` record. When absent, the hook retains its warn-only
   * behaviour. P12 wires this based on real settings.
   */
  memoryController?: MemoryTelemetryController;
}

export function useMemoryMonitor({
  addItem,
  memoryController,
}: UseMemoryMonitorOptions): void {
  useEffect(() => {
    const ports = __portsForTesting ?? realPorts;
    // Warn-once latch, separated from the sampling loop (DEFECT 1 fix):
    // the interval continues regardless of whether a warning has fired.
    let warnedOnce = false;

    // Shared high-memory warning so the telemetry-enabled and disabled paths
    // cannot drift. Fires once via the latch.
    const maybeWarn = (rss: number): void => {
      if (rss > MEMORY_WARNING_THRESHOLD_BYTES && !warnedOnce) {
        addItem(
          {
            type: MessageType.WARNING,
            text:
              `High memory usage detected: ${(
                rss /
                (1024 * 1024 * 1024)
              ).toFixed(2)} GB. ` +
              'If the CLI exits unexpectedly, please run `/bug` to report it.',
          },
          Date.now(),
        );
        warnedOnce = true;
      }
    };

    const intervalId = ports.setInterval(() => {
      if (memoryController !== undefined) {
        // Telemetry-enabled tick: exactly one full process.memoryUsage()
        // capture, reused for warning + ring + persistence.
        const sample = ports.memoryUsage();
        maybeWarn(sample.rss);
        memoryController.recordTickSample(sample);
      } else {
        // Disabled path: cheaper rss-only check (no full MemoryUsage object).
        maybeWarn(ports.rssBytes());
      }
    }, MEMORY_CHECK_INTERVAL_MS);

    return () => ports.clearInterval(intervalId);
  }, [addItem, memoryController]);
}
