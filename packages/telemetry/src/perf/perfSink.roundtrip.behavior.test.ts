/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-file behavioral tests for PerfSink (P04B, EVIDENCE-AC1).
 *
 * PerfSink is a constructible, non-singleton writer that uses a serialized
 * no-drop promise chain. One exclusive-created 0600 file per run UUID per UTC
 * record day: perf-YYYYMMDD-runUuid.jsonl. Empty sink creates no file. Drain
 * on dispose.
 *
 * Tests use REAL files and the REAL reader round-trip — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfSink } from './PerfSink.js';
import { readPerfRecords } from './perfRecords.js';

// ---------------------------------------------------------------------------
// Temp-dir helper
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-sink-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Valid record factory (plain object; PerfSink validates via the real schema)
// ---------------------------------------------------------------------------

function operationRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    record_type: 'operation',
    ts: '2026-08-08T12:00:00.000Z',
    session_id: 'sess-abc',
    operation_id: 'sess-abc#agentic-loop#f7e2',
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
    context_tokens: 1000,
    output_tokens: 500,
    terminal_cols: 120,
    terminal_rows: 40,
    render_mode: 'incremental',
    concurrent_instances: 1,
    status: 'completed',
    client_prepare_ms: 5,
    stream_handler_ms: 10,
    ink_render_ms: 20,
    ink_render_count: 3,
    stdout_bytes: 4096,
    stdout_write_calls: 3,
    stdout_write_sync_ms: 2,
    client_finalize_ms: 1,
    provider_attempts: 1,
    provider_attempt_sum_ms: 800,
    provider_union_ms: 800,
    tool_calls: 2,
    tool_call_sum_ms: 300,
    tool_union_ms: 280,
    agent_activity_union_ms: 1000,
    operation_elapsed_ms: 1200,
    approval_wait_ms: 0,
    unclassified_elapsed_ms: 100,
    session_operation_index: 1,
    uptime_ms: 50000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Round-trip: writer → filesystem → real reader (EVIDENCE-AC1)
// ---------------------------------------------------------------------------

describe('PerfSink round-trip (AC-1)', () => {
  it('writes a record that round-trips through the real reader with exact field values', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000000',
    });

    const source = operationRecord({
      status: 'superseded',
      unclassified_elapsed_ms: -42,
      tool_union_ms: 280,
      external_bytes: 99,
      concurrent_instances: 3,
      session_operation_index: 7,
    });

    await sink.write(source);
    await sink.dispose();

    const files = fs.readdirSync(dir);
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-000000000000.jsonl',
    ]);

    const { records, counts } = await readPerfRecords(path.join(dir, files[0]));
    expect(counts.parsed).toBe(1);
    expect(records).toHaveLength(1);

    const [parsed] = records;
    expect(parsed.record_type).toBe('operation');
    if (parsed.record_type !== 'operation') return;
    expect(parsed).toMatchObject({
      schema_version: 1,
      record_type: 'operation',
      ts: '2026-08-08T12:00:00.000Z',
      operation_id: 'sess-abc#agentic-loop#f7e2',
      status: 'superseded',
      unclassified_elapsed_ms: -42,
      tool_union_ms: 280,
      external_bytes: 99,
      concurrent_instances: 3,
      session_operation_index: 7,
    });
    // D1: no child-id arrays
    expect('prompt_ids' in parsed).toBe(false);
    expect('turn_ids' in parsed).toBe(false);
  });

  it('writes memory fields when present and round-trips them', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000001',
    });

    await sink.write(
      operationRecord({
        rss_bytes: 200_000_000,
        heap_used_bytes: 100_000_000,
        external_bytes: 30_000_000,
        array_buffers_bytes: 2_000_000,
      }),
    );
    await sink.dispose();

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);

    const { records } = await readPerfRecords(path.join(dir, files[0]));
    expect(records).toHaveLength(1);
    const [parsed] = records;
    expect(parsed.record_type).toBe('operation');
    if (parsed.record_type !== 'operation') return;
    expect(parsed.rss_bytes).toBe(200_000_000);
    expect(parsed.heap_used_bytes).toBe(100_000_000);
  });
});

// ---------------------------------------------------------------------------
// Concurrent writes → ordered, untorn lines
// ---------------------------------------------------------------------------

describe('PerfSink concurrency (AC-1)', () => {
  it('N concurrent writes produce N ordered untorn lines', async () => {
    const N = 100;
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000002',
    });

    const records = Array.from({ length: N }, (_, i) =>
      operationRecord({ session_operation_index: i }),
    );

    // Fire all writes without awaiting individually first.
    const promises = records.map((r) => sink.write(r));
    await Promise.all(promises);
    await sink.dispose();

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);

    const { records: read, counts } = await readPerfRecords(
      path.join(dir, files[0]),
    );
    expect(counts.parsed).toBe(N);
    expect(counts.malformed).toBe(0);
    expect(read).toHaveLength(N);

    // Verify order is preserved and no torn lines.
    for (let i = 0; i < N; i++) {
      const rec = read[i];
      expect(rec.record_type).toBe('operation');
      expect(
        (rec as { session_operation_index: number }).session_operation_index,
      ).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// Distinct run UUIDs → distinct files (exclusive create)
// ---------------------------------------------------------------------------

describe('PerfSink exclusive create (AC-1)', () => {
  it('distinct run UUID sinks do not share files', async () => {
    const sink1 = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000003',
    });
    const sink2 = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000004',
    });

    await sink1.write(operationRecord());
    await sink2.write(operationRecord());
    await sink1.dispose();
    await sink2.dispose();

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-000000000003.jsonl',
      'perf-20260808-00000000-0000-4000-8000-000000000004.jsonl',
    ]);

    // Each file has exactly one record.
    for (const f of files) {
      const { counts } = await readPerfRecords(path.join(dir, f));
      expect(counts.parsed).toBe(1);
    }
  });

  // POSIX-only. NTFS does not implement Unix permission bits, so Node reports
  // a synthesised mode on Windows and `stat.mode & 0o777` can never equal
  // 0o600 there no matter what the sink requests. The 0600 request itself is
  // still exercised on Linux and macOS, which is where the guarantee means
  // anything.
  it.skipIf(process.platform === 'win32')(
    'creates the file with 0600 permissions',
    async () => {
      const sink = new PerfSink({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000005',
      });
      await sink.write(operationRecord());
      await sink.dispose();

      const files = fs.readdirSync(dir);
      const stat = fs.statSync(path.join(dir, files[0]));
      // Mask to permission bits only.
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );
});

// ---------------------------------------------------------------------------
// UTC midnight roll
// ---------------------------------------------------------------------------

describe('PerfSink UTC midnight roll (AC-1)', () => {
  it('a record crossing UTC midnight rolls to a second file and both parse', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000006',
    });

    await sink.write(operationRecord({ ts: '2026-08-08T23:59:59.999Z' }));
    await sink.write(operationRecord({ ts: '2026-08-09T00:00:00.000Z' }));
    await sink.dispose();

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-000000000006.jsonl',
      'perf-20260809-00000000-0000-4000-8000-000000000006.jsonl',
    ]);

    const result1 = await readPerfRecords(path.join(dir, files[0]));
    expect(result1.counts.parsed).toBe(1);

    const result2 = await readPerfRecords(path.join(dir, files[1]));
    expect(result2.counts.parsed).toBe(1);
  });

  it('does not roll when consecutive records share the same day', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000007',
    });

    await sink.write(operationRecord({ ts: '2026-08-08T01:00:00.000Z' }));
    await sink.write(operationRecord({ ts: '2026-08-08T23:00:00.000Z' }));
    await sink.dispose();

    const files = fs.readdirSync(dir);
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-000000000007.jsonl',
    ]);
  });

  it('a record whose UTC day moves backwards re-adopts the earlier-day file without losing records', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-0000000000bd',
    });

    // day 1 → day 2 (forward roll) → day 1 again (backward roll).
    await sink.write(
      operationRecord({
        ts: '2026-08-08T12:00:00.000Z',
        operation_id: 'sess-abc#agentic-loop#d1a',
      }),
    );
    await sink.write(
      operationRecord({
        ts: '2026-08-09T12:00:00.000Z',
        operation_id: 'sess-abc#agentic-loop#d2',
      }),
    );
    await sink.write(
      operationRecord({
        ts: '2026-08-08T13:00:00.000Z',
        operation_id: 'sess-abc#agentic-loop#d1b',
      }),
    );
    await sink.dispose();

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-0000000000bd.jsonl',
      'perf-20260809-00000000-0000-4000-8000-0000000000bd.jsonl',
    ]);

    // Both day-1 records survive — the backward-day record was not lost.
    const day1 = await readPerfRecords(path.join(dir, files[0]));
    expect(day1.counts.parsed).toBe(2);
    const day2 = await readPerfRecords(path.join(dir, files[1]));
    expect(day2.counts.parsed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Empty sink creates no file
// ---------------------------------------------------------------------------

describe('PerfSink empty (AC-1)', () => {
  it('an empty sink creates no file', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000008',
    });
    await sink.dispose();

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(0);
  });

  it('dispose on an empty sink does not throw', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000009',
    });
    await expect(sink.dispose()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dispose drains accepted writes
// ---------------------------------------------------------------------------

describe('PerfSink dispose drains (AC-1)', () => {
  it('dispose drains all accepted writes before returning', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000a',
    });

    const N = 50;
    const promises = Array.from({ length: N }, (_, i) =>
      sink.write(operationRecord({ session_operation_index: i })),
    );

    // Dispose without awaiting individual writes.
    await sink.dispose();

    // All writes should have been drained.
    await Promise.all(promises);

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const { counts } = await readPerfRecords(path.join(dir, files[0]));
    expect(counts.parsed).toBe(N);
  });

  it('write after dispose is a no-op (no new file created)', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000b',
    });
    await sink.write(operationRecord());
    await sink.dispose();

    // Write after dispose should not create new content.
    await sink.write(operationRecord({ ts: '2026-08-09T00:00:00.000Z' }));

    const files = fs.readdirSync(dir);
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-00000000000b.jsonl',
    ]);
    const { counts } = await readPerfRecords(path.join(dir, files[0]));
    expect(counts.parsed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fail-fast: invalid records reject at the schema boundary
// ---------------------------------------------------------------------------

describe('PerfSink fail-fast for invalid records', () => {
  it('rejects a record missing required fields', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000c',
    });
    expect(() =>
      sink.write({ schema_version: 1, record_type: 'operation' }),
    ).toThrow('invalid');
    await sink.dispose();
  });

  it('rejects a record with an invalid field value', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000d',
    });
    expect(() => sink.write(operationRecord({ terminal_cols: -1 }))).toThrow(
      'terminal_cols',
    );
    await sink.dispose();
  });

  it('rejects null input', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000e',
    });
    expect(() => sink.write(null)).toThrow('Expected');
    await sink.dispose();
  });

  it('does not create a file when the record is invalid', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-00000000000f',
    });
    expect(() => sink.write({ bad: 'record' })).toThrow('invalid');
    await sink.dispose();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});
