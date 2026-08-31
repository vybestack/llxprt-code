/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral boundary tests for the tightened v1 perf schema (P04A correction A).
 *
 * The schema must encode accepted value boundaries:
 *  - ts: ISO 8601 timestamp
 *  - all durations except unclassified_elapsed_ms: finite and non-negative
 *  - unclassified_elapsed_ms: finite but may be negative
 *  - counts/tokens/geometry/index/concurrent_instances: integers with
 *    appropriate non-negative/minimum constraints
 *  - byte/memory/uptime/sample ages: finite non-negative
 *
 * Unknown-field tolerance must be preserved.
 */

import { describe, it, expect } from 'bun:test';
import {
  PerfOperationRecordSchema,
  PerfMemorySampleRecordSchema,
} from './perfRecords.js';

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

// ---------------------------------------------------------------------------
// ts — ISO 8601 timestamp
// ---------------------------------------------------------------------------

describe('schema boundary — ts is ISO 8601', () => {
  it('accepts a UTC ISO 8601 timestamp', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ ts: '2026-08-08T12:00:00.000Z' }),
      ).success,
    ).toBe(true);
  });

  it('accepts an offset ISO 8601 timestamp', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ ts: '2026-08-08T12:00:00.000+02:00' }),
      ).success,
    ).toBe(true);
  });

  it('rejects a non-ISO string', () => {
    expect(
      PerfOperationRecordSchema.safeParse(operationRecord({ ts: 'not-a-date' }))
        .success,
    ).toBe(false);
  });

  it('rejects a timestamp without timezone', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ ts: '2026-08-08T12:00:00' }),
      ).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Durations — finite and non-negative (except unclassified_elapsed_ms)
// ---------------------------------------------------------------------------

describe('schema boundary — durations are finite and non-negative', () => {
  const nonNegDurations = [
    'client_prepare_ms',
    'stream_handler_ms',
    'ink_render_ms',
    'stdout_write_sync_ms',
    'client_finalize_ms',
    'provider_attempt_sum_ms',
    'provider_union_ms',
    'tool_call_sum_ms',
    'tool_union_ms',
    'agent_activity_union_ms',
    'operation_elapsed_ms',
    'approval_wait_ms',
  ] as const;

  for (const field of nonNegDurations) {
    it(`rejects negative ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: -1 }))
          .success,
      ).toBe(false);
    });

    it(`rejects Infinity for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(
          operationRecord({ [field]: Number.POSITIVE_INFINITY }),
        ).success,
      ).toBe(false);
    });

    it(`rejects NaN for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(
          operationRecord({ [field]: Number.NaN }),
        ).success,
      ).toBe(false);
    });

    it(`accepts zero for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 0 }))
          .success,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// unclassified_elapsed_ms — finite but may be negative
// ---------------------------------------------------------------------------

describe('schema boundary — unclassified_elapsed_ms is finite, may be negative', () => {
  it('accepts a negative value', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ unclassified_elapsed_ms: -500 }),
      ).success,
    ).toBe(true);
  });

  it('accepts zero', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ unclassified_elapsed_ms: 0 }),
      ).success,
    ).toBe(true);
  });

  it('rejects Infinity', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ unclassified_elapsed_ms: Number.POSITIVE_INFINITY }),
      ).success,
    ).toBe(false);
  });

  it('rejects NaN', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ unclassified_elapsed_ms: Number.NaN }),
      ).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Counts — integers, non-negative
// ---------------------------------------------------------------------------

describe('schema boundary — counts are non-negative integers', () => {
  const countFields = [
    'ink_render_count',
    'stdout_write_calls',
    'provider_attempts',
    'tool_calls',
  ] as const;

  for (const field of countFields) {
    it(`rejects negative ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: -1 }))
          .success,
      ).toBe(false);
    });

    it(`rejects non-integer ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 1.5 }))
          .success,
      ).toBe(false);
    });

    it(`accepts zero for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 0 }))
          .success,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Tokens — integers, non-negative
// ---------------------------------------------------------------------------

describe('schema boundary — tokens are non-negative integers', () => {
  for (const field of ['context_tokens', 'output_tokens'] as const) {
    it(`rejects negative ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: -1 }))
          .success,
      ).toBe(false);
    });

    it(`rejects non-integer ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 1.5 }))
          .success,
      ).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Geometry — non-negative integers (unknown terminal geometry is zero — P12)
// ---------------------------------------------------------------------------

describe('schema boundary — geometry are non-negative integers (unknown is zero)', () => {
  for (const field of ['terminal_cols', 'terminal_rows'] as const) {
    it(`accepts zero for ${field} (unknown terminal geometry)`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 0 }))
          .success,
      ).toBe(true);
    });

    it(`rejects negative for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: -1 }))
          .success,
      ).toBe(false);
    });

    it(`rejects non-integer for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 80.5 }))
          .success,
      ).toBe(false);
    });

    it(`accepts 1 for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse(operationRecord({ [field]: 1 }))
          .success,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// concurrent_instances — integer, minimum 1
// ---------------------------------------------------------------------------

describe('schema boundary — concurrent_instances is integer with minimum 1', () => {
  it('rejects zero', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ concurrent_instances: 0 }),
      ).success,
    ).toBe(false);
  });

  it('rejects negative', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ concurrent_instances: -1 }),
      ).success,
    ).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ concurrent_instances: 1.5 }),
      ).success,
    ).toBe(false);
  });

  it('accepts 1', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ concurrent_instances: 1 }),
      ).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// session_operation_index — integer, non-negative
// ---------------------------------------------------------------------------

describe('schema boundary — session_operation_index is non-negative integer', () => {
  it('rejects negative', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ session_operation_index: -1 }),
      ).success,
    ).toBe(false);
  });

  it('rejects non-integer', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ session_operation_index: 1.5 }),
      ).success,
    ).toBe(false);
  });

  it('accepts zero', () => {
    expect(
      PerfOperationRecordSchema.safeParse(
        operationRecord({ session_operation_index: 0 }),
      ).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bytes/memory/uptime — finite, non-negative
// ---------------------------------------------------------------------------

describe('schema boundary — bytes/memory/uptime are finite non-negative', () => {
  const byteFields = [
    'stdout_bytes',
    'rss_bytes',
    'heap_used_bytes',
    'external_bytes',
    'array_buffers_bytes',
    'uptime_ms',
  ] as const;

  for (const field of byteFields) {
    const base =
      field === 'stdout_bytes'
        ? operationRecord()
        : operationRecord({
            rss_bytes: 120_000_000,
            heap_used_bytes: 60_000_000,
            external_bytes: 25_000_000,
            array_buffers_bytes: 1_500_000,
          });

    it(`rejects negative ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse({
          ...base,
          [field]: -1,
        }).success,
      ).toBe(false);
    });

    it(`rejects Infinity for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse({
          ...base,
          [field]: Number.POSITIVE_INFINITY,
        }).success,
      ).toBe(false);
    });

    it(`rejects NaN for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse({
          ...base,
          [field]: Number.NaN,
        }).success,
      ).toBe(false);
    });

    it(`accepts zero for ${field}`, () => {
      expect(
        PerfOperationRecordSchema.safeParse({
          ...base,
          [field]: 0,
        }).success,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Memory sample — sample ages finite non-negative
// ---------------------------------------------------------------------------

describe('schema boundary — memory sample fields finite non-negative', () => {
  const sampleFields = [
    'rss_bytes',
    'heap_used_bytes',
    'external_bytes',
    'array_buffers_bytes',
    'uptime_ms',
    'ms_since_last_operation',
  ] as const;

  for (const field of sampleFields) {
    it(`rejects negative ${field}`, () => {
      expect(
        PerfMemorySampleRecordSchema.safeParse(
          memorySampleRecord({ [field]: -1 }),
        ).success,
      ).toBe(false);
    });

    it(`rejects Infinity for ${field}`, () => {
      expect(
        PerfMemorySampleRecordSchema.safeParse(
          memorySampleRecord({ [field]: Number.POSITIVE_INFINITY }),
        ).success,
      ).toBe(false);
    });

    it(`rejects NaN for ${field}`, () => {
      expect(
        PerfMemorySampleRecordSchema.safeParse(
          memorySampleRecord({ [field]: Number.NaN }),
        ).success,
      ).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Unknown-field tolerance preserved
// ---------------------------------------------------------------------------

describe('schema boundary — unknown-field tolerance preserved', () => {
  it('strips unknown fields on operation records', () => {
    const result = PerfOperationRecordSchema.safeParse(
      operationRecord({ future_metric_ms: 42, unknown_col: 'x' }),
    );
    expect(result.success).toBe(true);
    const data = requireSuccessfulParse(result);
    expect('future_metric_ms' in data).toBe(false);
    expect('unknown_col' in data).toBe(false);
  });

  it('strips unknown fields on memory sample records', () => {
    const result = PerfMemorySampleRecordSchema.safeParse(
      memorySampleRecord({ extra_field: true }),
    );
    expect(result.success).toBe(true);
    const data = requireSuccessfulParse(result);
    expect('extra_field' in data).toBe(false);
  });
});
