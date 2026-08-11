/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving tolerant v0 / unversioned operation normalization
 * (issue #3167 review finding D, spec §2).
 *
 * Grounded in the existing tokenUsageRecords normalization pattern (without
 * importing packages/agents): a missing schema_version + record_type object
 * that FULLY matches the operation payload shape normalizes to internal
 * operation form (schema_version 0). Arbitrary or incomplete unversioned
 * objects remain counted as unversioned.
 *
 * Preserves: valid current v1, unknown-field tolerance, future-version
 * skip/count, and final-line semantics (only unterminated JSON parse failure
 * is truncated).
 */

import { describe, it, expect } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyPerfLine,
  parsePerfRecord,
  readPerfRecords,
  streamPerfRecords,
} from './perfRecords.js';

// ---------------------------------------------------------------------------
// Record builders
// ---------------------------------------------------------------------------

function operationFields(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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

/** A valid v1 operation record (has schema_version + record_type). */
function v1Operation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    record_type: 'operation',
    ...operationFields(overrides),
  };
}

/** An unversioned operation payload: all operation fields, NO version/type. */
function unversionedOperation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return operationFields(overrides);
}

// ---------------------------------------------------------------------------
// classifyPerfLine: v0 normalization
// ---------------------------------------------------------------------------

describe('classifyPerfLine v0 normalization (finding D)', () => {
  it('normalizes an unversioned object that fully matches the operation shape to ok', () => {
    const c = classifyPerfLine(unversionedOperation());
    expect(c.kind).toBe('ok');
  });

  it('normalized v0 record carries schema_version 0 and record_type operation', () => {
    const c = classifyPerfLine(unversionedOperation());
    expect(c.kind).toBe('ok');
    if (c.kind !== 'ok') throw new Error('expected ok');
    expect(c.record.schema_version).toBe(0);
    expect(c.record.record_type).toBe('operation');
  });

  it('normalized v0 record preserves all operation fields', () => {
    const c = classifyPerfLine(
      unversionedOperation({ provider: 'anthropic', status: 'error' }),
    );
    expect(c.kind).toBe('ok');
    if (c.kind !== 'ok') throw new Error('expected ok');
    expect(c.record.record_type).toBe('operation');
    if (c.record.record_type !== 'operation') throw new Error('op');
    expect(c.record.provider).toBe('anthropic');
    expect(c.record.status).toBe('error');
  });

  it('strips unknown fields from a normalized v0 record (§2 tolerance)', () => {
    const c = classifyPerfLine(
      unversionedOperation({ future_field: 42, extra: 'x' }),
    );
    expect(c.kind).toBe('ok');
    if (c.kind !== 'ok') throw new Error('expected ok');
    expect('future_field' in c.record).toBe(false);
    expect('extra' in c.record).toBe(false);
  });

  it('classifies an incomplete unversioned object (missing fields) as unversioned', () => {
    // Missing required operation fields → does not fully match → unversioned.
    expect(classifyPerfLine({ foo: 'bar' }).kind).toBe('unversioned');
    expect(classifyPerfLine({ session_id: 'x', provider: 'y' }).kind).toBe(
      'unversioned',
    );
  });

  it('classifies an arbitrary unversioned object as unversioned', () => {
    expect(
      classifyPerfLine({ random: 'data', ts: '2026-01-01T00:00:00.000Z' }).kind,
    ).toBe('unversioned');
  });

  it('classifies non-object input as malformed (not unversioned)', () => {
    expect(classifyPerfLine('hello').kind).toBe('malformed');
    expect(classifyPerfLine(null).kind).toBe('malformed');
    expect(classifyPerfLine(42).kind).toBe('malformed');
  });
});

// ---------------------------------------------------------------------------
// parsePerfRecord: v0 normalization
// ---------------------------------------------------------------------------

describe('parsePerfRecord v0 normalization (finding D)', () => {
  it('returns a parsed record for a normalized v0 operation', () => {
    const parsed = parsePerfRecord(unversionedOperation());
    expect(parsed).not.toBeNull();
    if (parsed === null) throw new Error('expected a record');
    expect(parsed.record_type).toBe('operation');
    expect(parsed.schema_version).toBe(0);
  });

  it('returns null for an incomplete unversioned object', () => {
    expect(parsePerfRecord({ foo: 'bar' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Preservation: v1, future-version, tolerance
// ---------------------------------------------------------------------------

describe('v0 normalization preserves existing behavior (finding D)', () => {
  it('valid current v1 operation classifies as ok with schema_version 1', () => {
    const c = classifyPerfLine(v1Operation());
    expect(c.kind).toBe('ok');
    if (c.kind !== 'ok') throw new Error('expected ok');
    expect(c.record.schema_version).toBe(1);
  });

  it('future-version record is still future_version (skip+count)', () => {
    const c = classifyPerfLine({ ...v1Operation(), schema_version: 99 });
    expect(c).toMatchObject({ kind: 'future_version', schemaVersion: 99 });
  });

  it('v1 record with unknown fields still classifies as ok (stripped)', () => {
    const c = classifyPerfLine(v1Operation({ new_metric: 7 }));
    expect(c.kind).toBe('ok');
    if (c.kind !== 'ok') throw new Error('expected ok');
    expect('new_metric' in c.record).toBe(false);
  });

  it('a record with record_type but missing schema_version is malformed', () => {
    // record_type present, schema_version absent → NOT the v0 normalization
    // path (which requires BOTH missing). Falls through to normal validation
    // which requires schema_version → malformed.
    expect(
      classifyPerfLine({ record_type: 'operation', ...operationFields() }).kind,
    ).toBe('malformed');
  });

  it('a record with schema_version 0 but no record_type is malformed', () => {
    // schema_version present, record_type absent → NOT the v0 normalization
    // path. Falls through to normal validation which requires record_type →
    // malformed.
    expect(
      classifyPerfLine({ schema_version: 0, ...operationFields() }).kind,
    ).toBe('malformed');
  });
});

// ---------------------------------------------------------------------------
// Real-file + streaming tests
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `perf-v0-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('v0 normalization real-file + streaming (finding D)', () => {
  let dir: string;

  async function setup(): Promise<string> {
    dir = await makeTempDir();
    return dir;
  }

  async function cleanup(): Promise<void> {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it('readPerfRecords parses a file with v0 + v1 + unversioned records', async () => {
    const d = await setup();
    try {
      const filePath = join(d, 'perf-20260808-uuid.jsonl');
      const lines = [
        JSON.stringify(v1Operation({ operation_id: 'op-1' })),
        JSON.stringify(unversionedOperation({ operation_id: 'op-2' })),
        JSON.stringify({ random: 'unversioned-incomplete' }),
      ];
      await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

      const { records, counts } = await readPerfRecords(filePath);

      expect(records).toHaveLength(2);
      expect(records[0].schema_version).toBe(1);
      expect(records[1].schema_version).toBe(0);
      expect(counts.parsed).toBe(2);
      expect(counts.unversioned).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('streamPerfRecords yields ok for a normalized v0 line', async () => {
    const d = await setup();
    try {
      const filePath = join(d, 'perf-20260808-uuid.jsonl');
      await fs.writeFile(
        filePath,
        JSON.stringify(unversionedOperation()) + '\n',
        'utf8',
      );

      const entries = [];
      for await (const entry of streamPerfRecords(filePath)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('ok');
      if (entries[0].kind !== 'ok') throw new Error('expected ok');
      expect(entries[0].record.schema_version).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('final-line semantics: an unterminated v0 JSON line is still ok (content retained)', async () => {
    const d = await setup();
    try {
      const filePath = join(d, 'perf-20260808-uuid.jsonl');
      // A valid v0 JSON object WITHOUT a trailing newline — this is a
      // complete JSON value, just unterminated. It must parse to ok, NOT
      // truncated (only JSON.parse failure on the final line is truncated).
      await fs.writeFile(
        filePath,
        JSON.stringify(unversionedOperation()),
        'utf8',
      );

      const entries = [];
      for await (const entry of streamPerfRecords(filePath)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('ok');
    } finally {
      await cleanup();
    }
  });

  it('final-line semantics: an unterminated future-version line retains future_version classification', async () => {
    const d = await setup();
    try {
      const filePath = join(d, 'perf-20260808-uuid.jsonl');
      const futureRec = JSON.stringify({
        ...v1Operation(),
        schema_version: 5,
      });
      await fs.writeFile(filePath, futureRec, 'utf8'); // no trailing newline

      const entries = [];
      for await (const entry of streamPerfRecords(filePath)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('future_version');
    } finally {
      await cleanup();
    }
  });

  it('final-line semantics: only a genuinely broken final line is truncated', async () => {
    const d = await setup();
    try {
      const filePath = join(d, 'perf-20260808-uuid.jsonl');
      // A complete valid line + an unterminated broken JSON fragment.
      await fs.writeFile(
        filePath,
        JSON.stringify(v1Operation()) + '\n{"schema_version":1,"record_t',
        'utf8',
      );

      const entries = [];
      for await (const entry of streamPerfRecords(filePath)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(2);
      expect(entries[0].kind).toBe('ok');
      expect(entries[1].kind).toBe('truncated');
    } finally {
      await cleanup();
    }
  });
});
