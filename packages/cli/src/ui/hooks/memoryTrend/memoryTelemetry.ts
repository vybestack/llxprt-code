/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Constructible memory telemetry controller (P10, AC-10).
 *
 * Not a singleton: P12 constructs one only when perf AND memory telemetry are
 * enabled. It shares the existing PerfSink, maintains the bounded MemoryRing,
 * writes schema-valid `memory_sample` records, and exposes snapshots for the
 * P11 live `/perf` view.
 *
 * Two call sites:
 *  - useMemoryMonitor's 60 s tick → `recordTickSample` (memory pre-sampled once
 *    by the hook, passed in).
 *  - OperationLifecycleRegistry finalise → `markOperationEnd` +
 *    `sampleOperationEndMemory` (the controller samples memory itself once).
 *
 * Pre-first-operation `ms_since_last_operation` is the full uptime since
 * process start — honest, not a fabricated previous operation.
 */

import {
  PERF_SCHEMA_VERSION,
  PERF_RECORD_TYPE_MEMORY_SAMPLE,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type {
  PerfSink,
  PerfMemorySampleRecord,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { MemoryRing } from './memoryRing.js';
import type { MemoryRingSample } from './memoryRing.js';

/**
 * The four operation-end memory columns. Present on the operation record IFF
 * memory telemetry is enabled; omitted (never zeroed) when disabled.
 */
export interface MemoryColumns {
  readonly rss_bytes: number;
  readonly heap_used_bytes: number;
  readonly external_bytes: number;
  readonly array_buffers_bytes: number;
}

/**
 * Narrow interface the OperationLifecycleRegistry depends on. Decouples the
 * registry from the full controller so P12 can wire it with the real
 * controller or a test double.
 */
export interface OperationMemorySampler {
  /** Records the monotonic time of operation end for idle computation. */
  markOperationEnd(): void;
  /** Samples process.memoryUsage() once and returns the four memory columns. */
  sampleOperationEndMemory(): MemoryColumns;
}

export interface MemoryTelemetryControllerOptions {
  readonly sink: PerfSink;
  /** Wall-clock epoch millis for the record `ts`. Defaults to Date.now. */
  readonly wallNow?: () => number;
  /** Monotonic millis for uptime/idle. Defaults to performance.now. */
  readonly monotonicNow?: () => number;
  /** Memory sampler for operation-end. Defaults to process.memoryUsage. */
  readonly memoryNow?: () => NodeJS.MemoryUsage;
}

export class MemoryTelemetryController implements OperationMemorySampler {
  private readonly ring = new MemoryRing();
  private readonly sink: PerfSink;
  private readonly wallNow: () => number;
  private readonly monotonicNow: () => number;
  private readonly memoryNow: () => NodeJS.MemoryUsage;
  private lastOperationEndMs: number | null = null;
  /**
   * Controller-owned serialized write chain. Replaces the former
   * `void sink.write(...)` fire-and-forget so writes happen in order and
   * internal errors surface deterministically via {@link drain}. A local
   * no-op rejection handler is attached so a rejected write whose individual
   * promise was not awaited does not become a process-level unhandled
   * rejection; the chain itself remains rejected so drain() fails fast.
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: MemoryTelemetryControllerOptions) {
    this.sink = options.sink;
    this.wallNow = options.wallNow ?? (() => Date.now());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.memoryNow = options.memoryNow ?? (() => process.memoryUsage());
  }

  /**
   * Records a periodic memory sample from the 60 s tick. The caller
   * (useMemoryMonitor) has already called process.memoryUsage() once for the
   * warning check; the same full sample is passed here so there is exactly one
   * memoryUsage() call per tick.
   *
   * Pushes to the bounded ring and writes a schema-valid memory_sample record
   * through the shared PerfSink.
   */
  recordTickSample(sample: NodeJS.MemoryUsage): void {
    // Capture wallNow exactly once so the ring timestamp and the record ts
    // describe the same sample (P11 quality fix).
    const wallMs = this.wallNow();
    const uptime = this.monotonicNow();
    const msSinceLastOperation =
      this.lastOperationEndMs === null
        ? uptime
        : Math.max(0, uptime - this.lastOperationEndMs);

    const ringSample: MemoryRingSample = {
      rss: sample.rss,
      heapUsed: sample.heapUsed,
      external: sample.external,
      arrayBuffers: sample.arrayBuffers,
      uptimeMs: uptime,
      msSinceLastOperation,
      timestampMs: wallMs,
    };
    this.ring.push(ringSample);

    const record: PerfMemorySampleRecord = {
      schema_version: PERF_SCHEMA_VERSION,
      record_type: PERF_RECORD_TYPE_MEMORY_SAMPLE,
      ts: new Date(wallMs).toISOString(),
      rss_bytes: sample.rss,
      heap_used_bytes: sample.heapUsed,
      external_bytes: sample.external,
      array_buffers_bytes: sample.arrayBuffers,
      uptime_ms: uptime,
      ms_since_last_operation: msSinceLastOperation,
    };
    void this.writeSerialized(record);
  }

  /**
   * Queues a record write through the controller-owned serialized chain.
   * Attaches a local no-op rejection handler so a rejected write that was not
   * individually awaited does not become a process-level unhandled rejection.
   * The chain itself remains rejected so {@link drain} surfaces the error.
   * External errno filesystem writes resolve fail-open inside PerfSink.
   */
  private writeSerialized(record: PerfMemorySampleRecord): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.sink.write(record));
    void this.writeChain.catch(() => {});
    return this.writeChain;
  }

  /**
   * Awaits all queued memory_sample writes through the serialized chain.
   * The runtime (before disposal) and tests call this to deterministically
   * flush pending writes. Rejects on internal async sink/programming failures;
   * external errno filesystem writes already resolve fail-open in PerfSink.
   */
  async drain(): Promise<void> {
    await this.writeChain;
  }

  markOperationEnd(): void {
    this.lastOperationEndMs = this.monotonicNow();
  }

  sampleOperationEndMemory(): MemoryColumns {
    const s = this.memoryNow();
    return {
      rss_bytes: s.rss,
      heap_used_bytes: s.heapUsed,
      external_bytes: s.external,
      array_buffers_bytes: s.arrayBuffers,
    };
  }

  /**
   * Returns a defensive copy of the ring contents (oldest→newest) for the P11
   * live `/perf` view.
   */
  snapshot(): readonly MemoryRingSample[] {
    return this.ring.snapshot();
  }
}
