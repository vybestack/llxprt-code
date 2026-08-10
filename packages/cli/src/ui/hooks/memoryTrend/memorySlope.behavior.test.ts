/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 behavioral tests for read-time memory slope derivation (EVIDENCE-AC10).
 *
 * Slopes are DERIVED at read time, never persisted. Two axes:
 *  - per-operation: least-squares of each memory column on session_operation_index
 *  - per-minute:     least-squares of each memory column on uptime_ms (→ bytes/min)
 *
 * Requires ≥2 usable points and nonzero x variance; otherwise null (never
 * NaN/Infinity). Negative slopes are preserved (not clamped). Functions operate
 * on a single record series (one run/file) — P11 invokes per file.
 */

import { describe, it, expect } from 'bun:test';
import {
  derivePerOperationMemorySlope,
  derivePerMinuteMemorySlope,
} from './memorySlope.js';
import type {
  PerfOperationRecord,
  PerfMemorySampleRecord,
} from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';

// ---------------------------------------------------------------------------
// Helpers — build valid records with known linear memory data
// ---------------------------------------------------------------------------

function makeOpRecord(
  index: number,
  mem: { rss: number; heap: number; ext: number; arr: number },
): PerfOperationRecord {
  return {
    schema_version: 1,
    record_type: 'operation',
    ts: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
    session_id: 'sess-1',
    operation_id: `op-${index}`,
    runtime_id: 'rt-1',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'hash',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin-arm64',
    provider: 'openai',
    model: 'gpt-4o',
    context_tokens: 100,
    output_tokens: 50,
    terminal_cols: 120,
    terminal_rows: 40,
    render_mode: 'incremental',
    concurrent_instances: 1,
    status: 'completed',
    client_prepare_ms: 10,
    stream_handler_ms: 5,
    ink_render_ms: 3,
    ink_render_count: 1,
    stdout_bytes: 100,
    stdout_write_calls: 1,
    stdout_write_sync_ms: 1,
    client_finalize_ms: 1,
    provider_attempts: 1,
    provider_attempt_sum_ms: 100,
    provider_union_ms: 100,
    tool_calls: 0,
    tool_call_sum_ms: 0,
    tool_union_ms: 0,
    agent_activity_union_ms: 100,
    operation_elapsed_ms: 500,
    approval_wait_ms: 0,
    unclassified_elapsed_ms: 400,
    session_operation_index: index,
    uptime_ms: index * 60_000,
    rss_bytes: mem.rss,
    heap_used_bytes: mem.heap,
    external_bytes: mem.ext,
    array_buffers_bytes: mem.arr,
  };
}

function makeOpRecordNoMemory(index: number): PerfOperationRecord {
  const rec = makeOpRecord(index, { rss: 0, heap: 0, ext: 0, arr: 0 });
  const {
    rss_bytes: _r,
    heap_used_bytes: _h,
    external_bytes: _e,
    array_buffers_bytes: _a,
    ...rest
  } = rec;
  void _r;
  void _h;
  void _e;
  void _a;
  return rest as PerfOperationRecord;
}

function makeSampleRecord(
  uptimeMs: number,
  mem: { rss: number; heap: number; ext: number; arr: number },
): PerfMemorySampleRecord {
  return {
    schema_version: 1,
    record_type: 'memory_sample',
    ts: new Date(1_700_000_000_000 + uptimeMs).toISOString(),
    rss_bytes: mem.rss,
    heap_used_bytes: mem.heap,
    external_bytes: mem.ext,
    array_buffers_bytes: mem.arr,
    uptime_ms: uptimeMs,
    ms_since_last_operation: 30_000,
  };
}

// ---------------------------------------------------------------------------
// Per-operation slope
// ---------------------------------------------------------------------------

describe('derivePerOperationMemorySlope (AC-10)', () => {
  it('derives correct positive slope across all four metrics', () => {
    // rss grows 1000 bytes/operation; heap 2000; ext 3000; arr 4000.
    const ops: PerfOperationRecord[] = [
      makeOpRecord(0, { rss: 10_000, heap: 20_000, ext: 30_000, arr: 40_000 }),
      makeOpRecord(1, { rss: 11_000, heap: 22_000, ext: 33_000, arr: 44_000 }),
      makeOpRecord(2, { rss: 12_000, heap: 24_000, ext: 36_000, arr: 48_000 }),
      makeOpRecord(3, { rss: 13_000, heap: 26_000, ext: 39_000, arr: 52_000 }),
      makeOpRecord(4, { rss: 14_000, heap: 28_000, ext: 42_000, arr: 56_000 }),
    ];
    const slope = derivePerOperationMemorySlope(ops);
    expect(slope.rss_bytes_per_operation).toBeCloseTo(1000, 5);
    expect(slope.heap_used_bytes_per_operation).toBeCloseTo(2000, 5);
    expect(slope.external_bytes_per_operation).toBeCloseTo(3000, 5);
    expect(slope.array_buffers_bytes_per_operation).toBeCloseTo(4000, 5);
  });

  it('preserves negative slope (memory decreasing)', () => {
    const ops: PerfOperationRecord[] = [
      makeOpRecord(0, { rss: 50_000, heap: 50_000, ext: 50_000, arr: 50_000 }),
      makeOpRecord(1, { rss: 45_000, heap: 45_000, ext: 45_000, arr: 45_000 }),
      makeOpRecord(2, { rss: 40_000, heap: 40_000, ext: 40_000, arr: 40_000 }),
    ];
    const slope = derivePerOperationMemorySlope(ops);
    expect(slope.rss_bytes_per_operation).toBeCloseTo(-5000, 5);
    expect(slope.heap_used_bytes_per_operation).toBeCloseTo(-5000, 5);
  });

  it('returns null for fewer than 2 usable points', () => {
    const slope = derivePerOperationMemorySlope([
      makeOpRecord(0, { rss: 10_000, heap: 20_000, ext: 30_000, arr: 40_000 }),
    ]);
    expect(slope.rss_bytes_per_operation).toBeNull();
    expect(slope.heap_used_bytes_per_operation).toBeNull();
    expect(slope.external_bytes_per_operation).toBeNull();
    expect(slope.array_buffers_bytes_per_operation).toBeNull();
  });

  it('returns null for empty input', () => {
    const slope = derivePerOperationMemorySlope([]);
    expect(slope.rss_bytes_per_operation).toBeNull();
  });

  it('returns null when x variance is zero (all same index)', () => {
    const ops: PerfOperationRecord[] = [
      makeOpRecord(5, { rss: 10_000, heap: 20_000, ext: 30_000, arr: 40_000 }),
      makeOpRecord(5, { rss: 11_000, heap: 21_000, ext: 31_000, arr: 41_000 }),
    ];
    const slope = derivePerOperationMemorySlope(ops);
    expect(slope.rss_bytes_per_operation).toBeNull();
  });

  it('ignores records without memory columns', () => {
    const ops: PerfOperationRecord[] = [
      makeOpRecordNoMemory(0),
      makeOpRecord(1, { rss: 11_000, heap: 22_000, ext: 33_000, arr: 44_000 }),
      makeOpRecord(2, { rss: 12_000, heap: 24_000, ext: 36_000, arr: 48_000 }),
    ];
    const slope = derivePerOperationMemorySlope(ops);
    // Only 2 usable points (indices 1,2); slope = 1000 bytes/operation.
    expect(slope.rss_bytes_per_operation).toBeCloseTo(1000, 5);
  });

  it('exactly 2 points with nonzero variance yields a slope', () => {
    const ops: PerfOperationRecord[] = [
      makeOpRecord(0, { rss: 10_000, heap: 20_000, ext: 30_000, arr: 40_000 }),
      makeOpRecord(1, { rss: 15_000, heap: 25_000, ext: 35_000, arr: 45_000 }),
    ];
    const slope = derivePerOperationMemorySlope(ops);
    expect(slope.rss_bytes_per_operation).toBeCloseTo(5000, 5);
  });
});

// ---------------------------------------------------------------------------
// Per-minute slope
// ---------------------------------------------------------------------------

describe('derivePerMinuteMemorySlope (AC-10)', () => {
  it('derives correct positive slope across all four metrics', () => {
    // rss grows 1 byte/ms = 60000 bytes/min; heap 2; ext 3; arr 4.
    const samples: PerfMemorySampleRecord[] = [
      makeSampleRecord(0, {
        rss: 10_000,
        heap: 20_000,
        ext: 30_000,
        arr: 40_000,
      }),
      makeSampleRecord(60_000, {
        rss: 70_000,
        heap: 140_000,
        ext: 210_000,
        arr: 280_000,
      }),
      makeSampleRecord(120_000, {
        rss: 130_000,
        heap: 260_000,
        ext: 390_000,
        arr: 520_000,
      }),
      makeSampleRecord(180_000, {
        rss: 190_000,
        heap: 380_000,
        ext: 570_000,
        arr: 760_000,
      }),
      makeSampleRecord(240_000, {
        rss: 250_000,
        heap: 500_000,
        ext: 750_000,
        arr: 1_000_000,
      }),
    ];
    const slope = derivePerMinuteMemorySlope(samples);
    expect(slope.rss_bytes_per_minute).toBeCloseTo(60_000, 0);
    expect(slope.heap_used_bytes_per_minute).toBeCloseTo(120_000, 0);
    expect(slope.external_bytes_per_minute).toBeCloseTo(180_000, 0);
    expect(slope.array_buffers_bytes_per_minute).toBeCloseTo(240_000, 0);
  });

  it('preserves negative slope (memory decreasing over time)', () => {
    const samples: PerfMemorySampleRecord[] = [
      makeSampleRecord(0, {
        rss: 1_000_000,
        heap: 1_000_000,
        ext: 1_000_000,
        arr: 1_000_000,
      }),
      makeSampleRecord(60_000, {
        rss: 940_000,
        heap: 940_000,
        ext: 940_000,
        arr: 940_000,
      }),
      makeSampleRecord(120_000, {
        rss: 880_000,
        heap: 880_000,
        ext: 880_000,
        arr: 880_000,
      }),
    ];
    const slope = derivePerMinuteMemorySlope(samples);
    // -1 byte/ms × 60000 = -60000 bytes/min.
    expect(slope.rss_bytes_per_minute).toBeCloseTo(-60_000, 0);
    expect(slope.heap_used_bytes_per_minute).toBeCloseTo(-60_000, 0);
  });

  it('returns null for fewer than 2 usable points', () => {
    const slope = derivePerMinuteMemorySlope([
      makeSampleRecord(0, {
        rss: 10_000,
        heap: 20_000,
        ext: 30_000,
        arr: 40_000,
      }),
    ]);
    expect(slope.rss_bytes_per_minute).toBeNull();
    expect(slope.heap_used_bytes_per_minute).toBeNull();
  });

  it('returns null for empty input', () => {
    const slope = derivePerMinuteMemorySlope([]);
    expect(slope.rss_bytes_per_minute).toBeNull();
  });

  it('returns null when x variance is zero (all same uptime)', () => {
    const samples: PerfMemorySampleRecord[] = [
      makeSampleRecord(60_000, {
        rss: 10_000,
        heap: 20_000,
        ext: 30_000,
        arr: 40_000,
      }),
      makeSampleRecord(60_000, {
        rss: 20_000,
        heap: 30_000,
        ext: 40_000,
        arr: 50_000,
      }),
    ];
    const slope = derivePerMinuteMemorySlope(samples);
    expect(slope.rss_bytes_per_minute).toBeNull();
  });

  it('exactly 2 points with nonzero variance yields a slope', () => {
    const samples: PerfMemorySampleRecord[] = [
      makeSampleRecord(0, {
        rss: 10_000,
        heap: 20_000,
        ext: 30_000,
        arr: 40_000,
      }),
      makeSampleRecord(60_000, {
        rss: 70_000,
        heap: 80_000,
        ext: 90_000,
        arr: 100_000,
      }),
    ];
    const slope = derivePerMinuteMemorySlope(samples);
    // 1 byte/ms × 60000 = 60000 bytes/min.
    expect(slope.rss_bytes_per_minute).toBeCloseTo(60_000, 0);
  });
});
