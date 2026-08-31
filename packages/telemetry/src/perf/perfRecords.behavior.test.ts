/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the v1 perf record schema, operation-id derivation,
 * and the tolerant per-line classifier/reader (AC-1 schema half, AC-3
 * derivation, AC-9 reader classification).
 *
 * These tests exercise the real Zod schema and the real classify/parse
 * functions — no mocks. A round-trip asserts against output produced by the
 * actual schema, never a hand-authored fixture shape.
 */

import { describe, it, expect } from 'bun:test';
import {
  PERF_SCHEMA_VERSION,
  PERF_RECORD_TYPE_OPERATION,
  PERF_RECORD_TYPE_MEMORY_SAMPLE,
  PERF_TERMINAL_STATUSES,
  PerfOperationRecordSchema,
  PerfMemorySampleRecordSchema,
  PerfRecordSchema,
  deriveOperationId,
  joinKeyFromPromptId,
  parsePerfRecord,
  classifyPerfLine,
} from './perfRecords.js';

// ---------------------------------------------------------------------------
// Record builders (test data only — produce plain objects validated by the
// real schema under test)
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

function operationRecordWithMemory(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return operationRecord({
    rss_bytes: 120_000_000,
    heap_used_bytes: 60_000_000,
    external_bytes: 25_000_000,
    array_buffers_bytes: 1_500_000,
    ...overrides,
  });
}

function memorySampleRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    record_type: 'memory_sample',
    ts: '2026-08-08T12:01:00.000Z',
    rss_bytes: 121_000_000,
    heap_used_bytes: 61_000_000,
    external_bytes: 25_500_000,
    array_buffers_bytes: 1_550_000,
    uptime_ms: 60000,
    ms_since_last_operation: 30000,
    ...overrides,
  };
}

function requireSuccessfulParse<T>(
  result:
    | { readonly success: true; readonly data: T }
    | { readonly success: false },
): T {
  if (!result.success) {
    throw new Error('expected parse success');
  }
  return result.data;
}

function requireParsedRecord(
  record: ReturnType<typeof parsePerfRecord>,
): NonNullable<ReturnType<typeof parsePerfRecord>> {
  if (record === null) {
    throw new Error('expected a parsed record');
  }
  return record;
}

// ---------------------------------------------------------------------------
// Schema version + record-type constants
// ---------------------------------------------------------------------------

describe('PERF_SCHEMA_VERSION and record-type constants', () => {
  it('is version 1', () => {
    expect(PERF_SCHEMA_VERSION).toBe(1);
  });

  it('declares the operation discriminator string', () => {
    expect(PERF_RECORD_TYPE_OPERATION).toBe('operation');
  });

  it('declares the memory_sample discriminator string', () => {
    expect(PERF_RECORD_TYPE_MEMORY_SAMPLE).toBe('memory_sample');
  });
});

// ---------------------------------------------------------------------------
// Operation record schema (AC-1 schema half)
// ---------------------------------------------------------------------------

describe('PerfOperationRecordSchema (AC-1 schema half)', () => {
  it('validates a complete operation record without memory fields', () => {
    const result = PerfOperationRecordSchema.safeParse(operationRecord());
    expect(result.success).toBe(true);
  });

  it('validates an operation record with the optional memory columns', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecordWithMemory(),
    );
    expect(result.success).toBe(true);
  });

  it('round-trips every field of a full (with-memory) operation record', () => {
    const source = operationRecordWithMemory({
      status: 'cancelled_during_tool',
      unclassified_elapsed_ms: 246,
      external_bytes: 99,
    });
    const result = PerfOperationRecordSchema.safeParse(source);
    expect(result.success).toBe(true);
    const data = requireSuccessfulParse(result);
    expect(data).toMatchObject({
      record_type: 'operation',
      schema_version: 1,
      status: 'cancelled_during_tool',
      unclassified_elapsed_ms: 246,
      external_bytes: 99,
      operation_id: 'sess-abc#agentic-loop#f7e2',
      runtime_id: 'rt-main',
      parent_runtime_id: null,
      subagent_name: null,
      concurrent_instances: 1,
      render_mode: 'incremental',
    });
  });

  it('omits memory fields when they are absent (not zero-filled)', () => {
    const result = PerfOperationRecordSchema.safeParse(operationRecord());
    expect(result.success).toBe(true);
    const data = requireSuccessfulParse(result);
    expect('rss_bytes' in data).toBe(false);
    expect('heap_used_bytes' in data).toBe(false);
    expect('external_bytes' in data).toBe(false);
    expect('array_buffers_bytes' in data).toBe(false);
  });

  it('strips unknown fields (a field addition is not a version bump — §2)', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({ future_metric_ms: 42, another_new_field: 'x' }),
    );
    expect(result.success).toBe(true);
    const data = requireSuccessfulParse(result);
    expect('future_metric_ms' in data).toBe(false);
    expect('another_new_field' in data).toBe(false);
  });

  it('rejects an empty operation_id at the schema boundary', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({ operation_id: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty session_id at the schema boundary', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({ session_id: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty provider string', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({ provider: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a non-null subagent_name for subagent records', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({
        runtime_id: 'rt-sub',
        parent_runtime_id: 'rt-main',
        subagent_name: 'researcher',
      }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seven terminal statuses (AC-4, spec §1.3)
// ---------------------------------------------------------------------------

describe('terminal statuses (AC-4)', () => {
  it('declares exactly the seven terminal values including superseded', () => {
    expect(PERF_TERMINAL_STATUSES).toStrictEqual([
      'completed',
      'error',
      'cancelled_before_send',
      'cancelled_during_api',
      'cancelled_during_tool',
      'cancelled_during_approval',
      'superseded',
    ]);
  });

  for (const status of PERF_TERMINAL_STATUSES) {
    it(`accepts status "${status}"`, () => {
      const result = PerfOperationRecordSchema.safeParse(
        operationRecord({ status }),
      );
      expect(result.success).toBe(true);
    });
  }

  it('rejects an unknown status value', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({ status: 'paused' }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D1: no child-id arrays / true-count / cap fields on the perf record
// ---------------------------------------------------------------------------

describe('D1 — no child-id arrays on the perf record', () => {
  it('strips prompt_ids/turn_ids/totals if present (they are not schema fields)', () => {
    const parsed = parsePerfRecord(
      operationRecord({
        prompt_ids: ['child-1', 'child-2'],
        turn_ids: ['turn-1'],
        prompt_ids_total: 2,
        turn_ids_total: 1,
      }),
    );
    expect(parsed).not.toBeNull();
    const record = requireParsedRecord(parsed);
    expect('prompt_ids' in record).toBe(false);
    expect('turn_ids' in record).toBe(false);
    expect('prompt_ids_total' in record).toBe(false);
    expect('turn_ids_total' in record).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Memory sample record schema (§7.2)
// ---------------------------------------------------------------------------

describe('PerfMemorySampleRecordSchema (§7.2)', () => {
  it('validates a complete memory_sample record', () => {
    const result = PerfMemorySampleRecordSchema.safeParse(memorySampleRecord());
    expect(result.success).toBe(true);
  });

  it('round-trips the memory values and idle marker', () => {
    const result = PerfMemorySampleRecordSchema.safeParse(
      memorySampleRecord({
        ms_since_last_operation: 120000,
        uptime_ms: 180000,
      }),
    );
    expect(result.success).toBe(true);
    const data = requireSuccessfulParse(result);
    expect(data).toMatchObject({
      record_type: 'memory_sample',
      schema_version: 1,
      ms_since_last_operation: 120000,
      uptime_ms: 180000,
    });
  });

  it('requires the four memory values', () => {
    const result = PerfMemorySampleRecordSchema.safeParse({
      schema_version: 1,
      record_type: 'memory_sample',
      ts: '2026-08-08T12:01:00.000Z',
      uptime_ms: 60000,
      ms_since_last_operation: 30000,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Union schema
// ---------------------------------------------------------------------------

describe('PerfRecordSchema discriminated union', () => {
  it('accepts an operation record', () => {
    expect(PerfRecordSchema.safeParse(operationRecord()).success).toBe(true);
  });

  it('accepts a memory_sample record', () => {
    expect(PerfRecordSchema.safeParse(memorySampleRecord()).success).toBe(true);
  });

  it('rejects an unknown record_type', () => {
    expect(
      PerfRecordSchema.safeParse({
        ...operationRecord(),
        record_type: 'unknown_kind',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveOperationId / joinKeyFromPromptId (AC-3, settled §3/§9)
// ---------------------------------------------------------------------------

describe('deriveOperationId (AC-3 — split rule)', () => {
  it('leaves an initial prompt id byte-identical (no continuation marker)', () => {
    const initial = 'sess-1#agentic-loop#f7e2-aaaa';
    expect(deriveOperationId(initial)).toBe(initial);
  });

  it('strips a single continuation marker to the prefix', () => {
    expect(
      deriveOperationId('sess-1#agentic-loop#f7e2-aaaa#continuation#1'),
    ).toBe('sess-1#agentic-loop#f7e2-aaaa');
  });

  it('strips continuation #2 to the same prefix as #1', () => {
    expect(
      deriveOperationId('sess-1#agentic-loop#f7e2-aaaa#continuation#2'),
    ).toBe('sess-1#agentic-loop#f7e2-aaaa');
  });

  it('strips a multi-digit continuation marker', () => {
    expect(
      deriveOperationId('sess-1#agentic-loop#f7e2-aaaa#continuation#12'),
    ).toBe('sess-1#agentic-loop#f7e2-aaaa');
  });

  it('strips a zero continuation (any occurrence begins the suffix)', () => {
    expect(
      deriveOperationId('sess-1#agentic-loop#f7e2-aaaa#continuation#0'),
    ).toBe('sess-1#agentic-loop#f7e2-aaaa');
  });

  it('strips a non-numeric continuation suffix (any occurrence begins the suffix)', () => {
    expect(
      deriveOperationId('sess-1#agentic-loop#f7e2-aaaa#continuation#abc'),
    ).toBe('sess-1#agentic-loop#f7e2-aaaa');
  });

  it('strips a negative continuation suffix (any occurrence begins the suffix)', () => {
    expect(
      deriveOperationId('sess-1#agentic-loop#f7e2-aaaa#continuation#-1'),
    ).toBe('sess-1#agentic-loop#f7e2-aaaa');
  });

  it('takes the first segment even when the marker is not terminal', () => {
    expect(deriveOperationId('sess-1#continuation#1#more')).toBe('sess-1');
  });

  it('takes the first segment for a trailing-empty marker', () => {
    expect(deriveOperationId('prefix#continuation#')).toBe('prefix');
  });

  it('preserves a CLI-fallback id (8-hash, no continuation marker)', () => {
    const fallback = 'test-session########0';
    expect(deriveOperationId(fallback)).toBe(fallback);
  });
});

describe('joinKeyFromPromptId (AC-3 read-time join, D1)', () => {
  it('derives the same key as deriveOperationId for an initial id', () => {
    const initial = 'sess-1#agentic-loop#f7e2-aaaa';
    expect(joinKeyFromPromptId(initial)).toBe(initial);
    expect(joinKeyFromPromptId(initial)).toBe(deriveOperationId(initial));
  });

  it('derives the same key as deriveOperationId for continuations', () => {
    const base = 'sess-1#agentic-loop#f7e2-aaaa';
    for (const n of [1, 2, 3, 10, 99]) {
      expect(joinKeyFromPromptId(`${base}#continuation#${n}`)).toBe(base);
      expect(joinKeyFromPromptId(`${base}#continuation#${n}`)).toBe(
        deriveOperationId(`${base}#continuation#${n}`),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// parsePerfRecord + classifyPerfLine (AC-9 reader classification)
// ---------------------------------------------------------------------------

describe('parsePerfRecord (AC-9 partial)', () => {
  it('returns a parsed operation record for valid input', () => {
    const result = parsePerfRecord(operationRecord());
    expect(result).not.toBeNull();
    const parsed = requireParsedRecord(result);
    expect(parsed.record_type).toBe('operation');
  });

  it('returns a parsed memory_sample record for valid input', () => {
    const result = parsePerfRecord(memorySampleRecord());
    expect(result).not.toBeNull();
    const parsed = requireParsedRecord(result);
    expect(parsed.record_type).toBe('memory_sample');
  });

  it('returns null for a future schema version (skip+count, never coerce)', () => {
    expect(
      parsePerfRecord({ ...operationRecord(), schema_version: 99 }),
    ).toBeNull();
  });

  it('returns null for an unversioned/legacy record (no version, no type)', () => {
    expect(
      parsePerfRecord({ foo: 'bar', ts: '2026-01-01T00:00:00.000Z' }),
    ).toBeNull();
  });

  it('returns null for a record missing required fields', () => {
    expect(
      parsePerfRecord({ schema_version: 1, record_type: 'operation' }),
    ).toBeNull();
  });

  it('returns null for null/undefined/string/number input without throwing', () => {
    expect(() => parsePerfRecord(null)).not.toThrow();
    expect(parsePerfRecord(null)).toBeNull();
    expect(parsePerfRecord(undefined)).toBeNull();
    expect(parsePerfRecord('not-an-object')).toBeNull();
    expect(parsePerfRecord(42)).toBeNull();
  });

  it('does not throw on an array', () => {
    expect(() => parsePerfRecord([1, 2, 3])).not.toThrow();
    expect(parsePerfRecord([1, 2, 3])).toBeNull();
  });
});

describe('classifyPerfLine (AC-9 reader classification)', () => {
  it('classifies a valid operation record as ok', () => {
    expect(classifyPerfLine(operationRecord()).kind).toBe('ok');
  });

  it('classifies a valid memory_sample record as ok', () => {
    expect(classifyPerfLine(memorySampleRecord()).kind).toBe('ok');
  });

  it('classifies a future-version record as future_version with the version', () => {
    const c = classifyPerfLine({ ...operationRecord(), schema_version: 7 });
    expect(c).toMatchObject({ kind: 'future_version', schemaVersion: 7 });
  });

  it('classifies an unversioned record (no version AND no type) as unversioned', () => {
    expect(
      classifyPerfLine({ some_legacy_field: 1, ts: '2026-01-01T00:00:00.000Z' })
        .kind,
    ).toBe('unversioned');
  });

  it('classifies a record missing required fields as malformed', () => {
    expect(
      classifyPerfLine({ schema_version: 1, record_type: 'operation' }).kind,
    ).toBe('malformed');
  });

  it('classifies non-object input (including arrays) as malformed', () => {
    expect(classifyPerfLine('hello').kind).toBe('malformed');
    expect(classifyPerfLine(null).kind).toBe('malformed');
    expect(classifyPerfLine(42).kind).toBe('malformed');
    // Arrays are malformed, NOT unversioned/v0 — isStringRecord excludes them.
    expect(classifyPerfLine([1, 2, 3]).kind).toBe('malformed');
  });
});
