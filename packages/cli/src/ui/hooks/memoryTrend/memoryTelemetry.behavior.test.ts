/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 behavioral tests for MemoryTelemetryController (EVIDENCE-AC10).
 *
 * Real PerfSink + real temp files + real tolerant reader. The controller is
 * constructible (no singleton), shares the existing PerfSink, maintains the
 * bounded ring, writes schema-valid memory_sample records, and exposes
 * snapshots for P11. No mock theatre.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfSink } from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfMemorySampleRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import { MemoryTelemetryController } from './memoryTelemetry.js';
import type { OperationMemorySampler } from './memoryTelemetry.js';

let dir: string;
const activeSinks: PerfSink[] = [];

describe('memory telemetry test lifecycle', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memtelemetry-'));
    activeSinks.length = 0;
  });

  afterEach(async () => {
    const errors: unknown[] = [];
    for (const sink of activeSinks) {
      try {
        await sink.dispose();
      } catch (err) {
        errors.push(err);
      }
    }
    activeSinks.length = 0;
    fs.rmSync(dir, { recursive: true, force: true });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'memoryTelemetry afterEach sink cleanup failed',
      );
    }
  });

  function makeSink(): PerfSink {
    const sink = new PerfSink({ dir, runUuid: crypto.randomUUID() });
    activeSinks.push(sink);
    return sink;
  }

  function fixtureMemory(rss: number): NodeJS.MemoryUsage {
    return {
      rss,
      heapUsed: rss + 1000,
      external: rss + 2000,
      arrayBuffers: rss + 3000,
    } as NodeJS.MemoryUsage;
  }

  async function readSampleRecords(
    controller: MemoryTelemetryController,
    sink: PerfSink,
  ): Promise<PerfMemorySampleRecord[]> {
    await controller.drain();
    await sink.dispose();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const records: PerfMemorySampleRecord[] = [];
    for (const file of files) {
      const result = await readPerfRecords(path.join(dir, file));
      for (const rec of result.records) {
        if (rec.record_type === 'memory_sample') {
          records.push(rec);
        }
      }
    }
    return records;
  }

  describe('MemoryTelemetryController — serialized write chain + drain (P12)', () => {
    it('drain() resolves when there are no internal errors', async () => {
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        monotonicNow: () => 1000,
        memoryNow: () => fixtureMemory(5000),
      });
      controller.recordTickSample(fixtureMemory(5000));
      controller.recordTickSample(fixtureMemory(6000));
      await controller.drain();
      // Both writes completed before drain resolved.
      const records = await readSampleRecords(controller, sink);
      expect(records).toHaveLength(2);
    });

    it('drain() rejects on internal sink/programming failure', async () => {
      // A sink that throws synchronously on write (a programming/schema error).
      const failingSink = {
        write(): Promise<void> {
          throw new Error('internal programming error');
        },
        start(): Promise<void> {
          return Promise.resolve();
        },
        dispose(): Promise<void> {
          return Promise.resolve();
        },
        get byteCount(): number {
          return 0;
        },
        get lastWriteErrorCode(): string | null {
          return null;
        },
      } as unknown as PerfSink;

      const controller = new MemoryTelemetryController({
        sink: failingSink,
        monotonicNow: () => 1000,
        memoryNow: () => fixtureMemory(5000),
      });
      controller.recordTickSample(fixtureMemory(5000));
      await expect(controller.drain()).rejects.toThrow(
        'internal programming error',
      );
    });

    it('writes are serialized in order through the chain', async () => {
      const writeOrder: number[] = [];
      const resolvers: Array<() => void> = [];
      const orderedSink = {
        write(_record: unknown): Promise<void> {
          const idx = writeOrder.length;
          writeOrder.push(idx);
          return new Promise<void>((resolve) => {
            resolvers.push(resolve);
          });
        },
        start(): Promise<void> {
          return Promise.resolve();
        },
        dispose(): Promise<void> {
          return Promise.resolve();
        },
        get byteCount(): number {
          return 0;
        },
        get lastWriteErrorCode(): string | null {
          return null;
        },
      } as unknown as PerfSink;

      const controller = new MemoryTelemetryController({
        sink: orderedSink,
        monotonicNow: () => 1000,
        memoryNow: () => fixtureMemory(5000),
      });
      controller.recordTickSample(fixtureMemory(1000));
      controller.recordTickSample(fixtureMemory(2000));
      controller.recordTickSample(fixtureMemory(3000));

      // Allow the first chained write's microtask to run. Only write 0 starts;
      // writes 1 and 2 are queued behind write 0's unresolved promise.
      await new Promise((r) => setTimeout(r, 10));
      expect(writeOrder).toStrictEqual([0]);

      // Resolve the first write; the second starts.
      resolvers[0]();
      await new Promise((r) => setTimeout(r, 10));
      expect(writeOrder).toStrictEqual([0, 1]);

      // Resolve the rest and drain.
      resolvers[1]();
      await new Promise((r) => setTimeout(r, 10));
      resolvers[2]();
      await controller.drain();
      expect(writeOrder).toStrictEqual([0, 1, 2]);
    });

    it('does not emit a process-level unhandled rejection on internal error', async () => {
      // If the no-op local rejection observer is missing, a rejected write
      // chain that was not individually awaited becomes an unhandled rejection.
      // We assert drain() surfaces the error AND no unhandledRejection event
      // fires during the window.
      let unhandledFired = false;
      const handler = (): void => {
        unhandledFired = true;
      };
      process.on('unhandledRejection', handler);

      try {
        const failingSink = {
          write(): Promise<void> {
            return Promise.reject(new Error('internal programming error'));
          },
          start(): Promise<void> {
            return Promise.resolve();
          },
          dispose(): Promise<void> {
            return Promise.resolve();
          },
          get byteCount(): number {
            return 0;
          },
          get lastWriteErrorCode(): string | null {
            return null;
          },
        } as unknown as PerfSink;

        const controller = new MemoryTelemetryController({
          sink: failingSink,
          monotonicNow: () => 1000,
          memoryNow: () => fixtureMemory(5000),
        });
        controller.recordTickSample(fixtureMemory(5000));
        // Give the microtask queue a chance to emit unhandledRejection.
        await new Promise((r) => setTimeout(r, 50));
        await expect(controller.drain()).rejects.toThrow(
          'internal programming error',
        );
        // Allow any pending microtasks to settle.
        await new Promise((r) => setTimeout(r, 50));
        expect(unhandledFired).toBe(false);
      } finally {
        process.off('unhandledRejection', handler);
      }
    });
  });

  describe('MemoryTelemetryController — recordTickSample (AC-10)', () => {
    it('writes a schema-valid memory_sample record with correct values', async () => {
      const mono = 5000;
      const wall = 1_700_000_000_000;
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        wallNow: () => wall,
        monotonicNow: () => mono,
        memoryNow: () => fixtureMemory(50_000_000),
      });

      controller.recordTickSample(fixtureMemory(50_000_000));
      const records = await readSampleRecords(controller, sink);
      expect(records).toHaveLength(1);
      const rec = records[0];
      expect(rec.record_type).toBe('memory_sample');
      expect(rec.schema_version).toBe(1);
      expect(rec.rss_bytes).toBe(50_000_000);
      expect(rec.heap_used_bytes).toBe(50_001_000);
      expect(rec.external_bytes).toBe(50_002_000);
      expect(rec.array_buffers_bytes).toBe(50_003_000);
      expect(rec.uptime_ms).toBe(5000);
      // Pre-first-operation: ms_since_last_operation = uptime (no fabricated
      // previous operation).
      expect(rec.ms_since_last_operation).toBe(5000);
      // ISO 8601 timestamp from the wall clock.
      expect(rec.ts).toBe(new Date(wall).toISOString());
    });

    it('pre-first-operation ms_since_last_operation equals uptime (honest)', async () => {
      const mono = 42_000;
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        monotonicNow: () => mono,
        memoryNow: () => fixtureMemory(1000),
      });

      controller.recordTickSample(fixtureMemory(1000));
      const records = await readSampleRecords(controller, sink);
      // No operation has ended, so idle = uptime since process start.
      expect(records[0].ms_since_last_operation).toBe(42_000);
      expect(records[0].uptime_ms).toBe(42_000);
    });

    it('after markOperationEnd, ms_since_last_operation is uptime minus last op end', async () => {
      let mono = 10_000;
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        monotonicNow: () => mono,
        memoryNow: () => fixtureMemory(1000),
      });

      // First tick at uptime 10_000 — pre-first-operation idle.
      controller.recordTickSample(fixtureMemory(1000));

      // Operation ends at uptime 15_000.
      mono = 15_000;
      controller.markOperationEnd();

      // Second tick at uptime 25_000 — idle = 25_000 - 15_000 = 10_000.
      mono = 25_000;
      controller.recordTickSample(fixtureMemory(2000));

      const records = await readSampleRecords(controller, sink);
      expect(records).toHaveLength(2);
      expect(records[0].ms_since_last_operation).toBe(10_000);
      expect(records[1].ms_since_last_operation).toBe(10_000);
      expect(records[1].uptime_ms).toBe(25_000);
    });
  });

  describe('MemoryTelemetryController — ring snapshot (AC-10/AC-11)', () => {
    it('snapshot exposes ring contents oldest→newest', async () => {
      let mono = 0;
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        monotonicNow: () => mono,
        memoryNow: () => fixtureMemory(1000),
      });

      mono = 1000;
      controller.recordTickSample(fixtureMemory(10_000));
      mono = 2000;
      controller.recordTickSample(fixtureMemory(20_000));
      mono = 3000;
      controller.recordTickSample(fixtureMemory(30_000));

      const snap = controller.snapshot();
      expect(snap).toHaveLength(3);
      expect(snap[0].rss).toBe(10_000);
      expect(snap[1].rss).toBe(20_000);
      expect(snap[2].rss).toBe(30_000);
      await controller.drain();
    });
  });

  describe('MemoryTelemetryController — operation-end memory (AC-10)', () => {
    it('sampleOperationEndMemory returns the four columns', () => {
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        memoryNow: () => fixtureMemory(77_777_777),
      });

      const columns = controller.sampleOperationEndMemory();
      expect(columns.rss_bytes).toBe(77_777_777);
      expect(columns.heap_used_bytes).toBe(77_778_777);
      expect(columns.external_bytes).toBe(77_779_777);
      expect(columns.array_buffers_bytes).toBe(77_780_777);
    });

    it('implements OperationMemorySampler interface', () => {
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        memoryNow: () => fixtureMemory(1000),
      });
      const sampler: OperationMemorySampler = controller;
      expect(typeof sampler.markOperationEnd).toBe('function');
      expect(typeof sampler.sampleOperationEndMemory).toBe('function');
    });

    it('markOperationEnd + sampleOperationEndMemory are idempotent for the columns', () => {
      const mono = 5000;
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        monotonicNow: () => mono,
        memoryNow: () => fixtureMemory(999),
      });

      controller.markOperationEnd();
      const cols1 = controller.sampleOperationEndMemory();
      const cols2 = controller.sampleOperationEndMemory();
      expect(cols1).toStrictEqual(cols2);
    });
  });

  describe('MemoryTelemetryController — no slope key in persisted records', () => {
    it('memory_sample records have no slope-related fields', async () => {
      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        monotonicNow: () => 1000,
        memoryNow: () => fixtureMemory(5000),
      });
      controller.recordTickSample(fixtureMemory(5000));
      const records = await readSampleRecords(controller, sink);
      expect(records).toHaveLength(1);
      const raw = JSON.parse(
        fs.readFileSync(
          path.join(
            dir,
            fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))[0],
          ),
          'utf8',
        ),
      );
      // No slope field anywhere in the persisted record.
      for (const key of Object.keys(raw)) {
        expect(key).not.toMatch(/slope/i);
      }
    });
  });

  describe('MemoryTelemetryController — wallNow captured once (P11 quality fix)', () => {
    it('ring timestamp and record ts derive from the same wallNow call', async () => {
      // A wallNow that increments on every call so two calls are distinguishable.
      let wallCallCount = 0;
      const baseWall = 1_700_000_000_000;
      const wallNow = (): number => {
        wallCallCount++;
        return baseWall + (wallCallCount - 1) * 1000;
      };

      const sink = makeSink();
      const controller = new MemoryTelemetryController({
        sink,
        wallNow,
        monotonicNow: () => 5000,
        memoryNow: () => fixtureMemory(50_000_000),
      });

      controller.recordTickSample(fixtureMemory(50_000_000));

      const snap = controller.snapshot();
      expect(snap).toHaveLength(1);

      const records = await readSampleRecords(controller, sink);
      expect(records).toHaveLength(1);

      // Both the ring timestamp and the record ts must derive from the same
      // wallNow() call. If wallNow were called twice (the pre-fix bug), the
      // record ts would be 1000ms later than the ring timestamp.
      expect(new Date(records[0].ts).getTime()).toBe(snap[0].timestampMs);
    });
  });
});
