/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 behavioral tests for OperationLifecycleRegistry memory columns (AC-10).
 *
 * With a memory sampler present: operation records carry the four memory
 * columns (rss_bytes, heap_used_bytes, external_bytes, array_buffers_bytes).
 * Without a sampler: all four fields are omitted (absent, never zeros).
 *
 * Real registry + real PerfSink/PerfRetention + real MemoryTelemetryController
 * + real temp files + real reader. No mock theatre.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import {
  OperationLifecycleRegistry,
  type OperationIdentityProvider,
  type OperationIdentitySnapshot,
} from './operationLifecycle.js';
import { MemoryTelemetryController } from '../memoryTrend/memoryTelemetry.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-p10-mem-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'sess-abc',
    runtime_id: 'rt-main',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'sha256:project-hash',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin-arm64',
    provider: 'openai',
    model: 'gpt-4o',
    terminal_cols: 120,
    terminal_rows: 40,
    render_mode: 'incremental',
  };
}

function fixtureProvider(): OperationIdentityProvider {
  const snap = fixtureIdentity();
  return { snapshot: () => snap };
}

function fixtureMemory(rss: number): NodeJS.MemoryUsage {
  return {
    rss,
    heapUsed: rss + 1000,
    external: rss + 2000,
    arrayBuffers: rss + 3000,
    heapTotal: rss + 5000,
  } as NodeJS.MemoryUsage;
}

async function readOpRecords(
  registry: OperationLifecycleRegistry,
  sink: PerfSink,
): Promise<PerfOperationRecord[]> {
  await registry.drain();
  await sink.dispose();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const records: PerfOperationRecord[] = [];
  for (const file of files) {
    const result = await readPerfRecords(path.join(dir, file));
    for (const rec of result.records) {
      if (rec.record_type === 'operation') {
        records.push(rec);
      }
    }
  }
  return records;
}

describe('P10 operation record memory columns (AC-10)', () => {
  it('memory ON: operation record includes all four memory columns', async () => {
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
    });
    await sink.start();
    const controller = new MemoryTelemetryController({
      sink,
      monotonicNow: () => 5000,
      memoryNow: () => fixtureMemory(42_000_000),
    });
    const registry = new OperationLifecycleRegistry({
      identityProvider: fixtureProvider(),
      sink,
      retention,
      memorySampler: controller,
    });

    const controller2 = new AbortController();
    registry.begin(controller2.signal, 'sess#agentic-loop#uuid');
    await registry.finalise(controller2.signal, 'completed');
    const records = await readOpRecords(registry, sink);
    expect(records).toHaveLength(1);
    expect(records[0].rss_bytes).toBe(42_000_000);
    expect(records[0].heap_used_bytes).toBe(42_001_000);
    expect(records[0].external_bytes).toBe(42_002_000);
    expect(records[0].array_buffers_bytes).toBe(42_003_000);
  });

  it('memory OFF (no sampler): operation record omits all four columns', async () => {
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
    });
    await sink.start();
    const registry = new OperationLifecycleRegistry({
      identityProvider: fixtureProvider(),
      sink,
      retention,
      // No memorySampler — memory disabled.
    });

    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    await registry.finalise(controller.signal, 'completed');
    const records = await readOpRecords(registry, sink);
    expect(records).toHaveLength(1);
    expect(records[0].rss_bytes).toBeUndefined();
    expect(records[0].heap_used_bytes).toBeUndefined();
    expect(records[0].external_bytes).toBeUndefined();
    expect(records[0].array_buffers_bytes).toBeUndefined();
  });

  it('memory ON: markOperationEnd is called at finalisation', async () => {
    let mono = 10_000;
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
    });
    await sink.start();
    const controller = new MemoryTelemetryController({
      sink,
      monotonicNow: () => mono,
      memoryNow: () => fixtureMemory(1000),
    });
    const registry = new OperationLifecycleRegistry({
      identityProvider: fixtureProvider(),
      sink,
      retention,
      memorySampler: controller,
      monotonicNow: () => mono,
    });

    try {
      // Operation ends at uptime 10_000 — markOperationEnd sets it.
      const c = new AbortController();
      registry.begin(c.signal, 'sess#agentic-loop#uuid');
      await registry.finalise(c.signal, 'completed');

      // Now a tick sample at uptime 20_000 should have idle = 10_000.
      mono = 20_000;
      controller.recordTickSample(fixtureMemory(2000));
      const snap = controller.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].msSinceLastOperation).toBe(10_000);
    } finally {
      await controller.drain();
      await sink.dispose();
    }
  });

  it('no slope key in persisted operation record', async () => {
    const runUuid = crypto.randomUUID();
    const retention = new PerfRetention({
      dir,
      runUuid,
      maintenanceIntervalMs: 60_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid,
      retention,
    });
    await sink.start();
    const controller = new MemoryTelemetryController({
      sink,
      monotonicNow: () => 5000,
      memoryNow: () => fixtureMemory(42_000_000),
    });
    const registry = new OperationLifecycleRegistry({
      identityProvider: fixtureProvider(),
      sink,
      retention,
      memorySampler: controller,
    });

    const c = new AbortController();
    registry.begin(c.signal, 'sess#agentic-loop#uuid');
    await registry.finalise(c.signal, 'completed');
    await registry.drain();
    await sink.dispose();

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    const raw = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    for (const key of Object.keys(raw)) {
      expect(key).not.toMatch(/slope/i);
    }
  });
});
