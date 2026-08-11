/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the tolerant streaming perf JSONL reader (AC-9 reader
 * partial). Every case writes a REAL temporary JSONL file and asserts on the
 * actual parsed records and self-health counters — no mocks.
 *
 * The reader must: stream lines (never read the whole file), tolerate
 * malformed/truncated final lines with explicit counters, ignore unknown
 * fields on known schema versions, skip+count future schema versions without
 * coercion, and never throw for malformed external JSONL. It must distinguish
 * a malformed complete line from a truncated final line.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readPerfRecords } from './perfRecords.js';

// ---------------------------------------------------------------------------
// Temp-file helper (real files, real fs)
// ---------------------------------------------------------------------------

function makeTempFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-reader-'));
  const filePath = path.join(dir, 'perf.jsonl');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function cleanupFile(filePath: string): void {
  try {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Valid record factories (plain objects; the real schema validates them)
// ---------------------------------------------------------------------------

function operationLine(overrides: Record<string, unknown> = {}): string {
  const record = {
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
  return JSON.stringify(record);
}

describe('readPerfRecords — happy path', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(
      [operationLine(), operationLine(), operationLine()].join('\n') + '\n',
    );
  });

  afterEach(() => cleanupFile(filePath));

  it('parses every valid operation record in the file', async () => {
    const { records, counts } = await readPerfRecords(filePath);
    expect(records).toHaveLength(3);
    expect(counts.parsed).toBe(3);
    for (const record of records) {
      expect(record.record_type).toBe('operation');
    }
  });

  it('reports zero for every non-parsed counter on a clean file', async () => {
    const { counts } = await readPerfRecords(filePath);
    expect(counts.malformed).toBe(0);
    expect(counts.futureVersion).toBe(0);
    expect(counts.unversioned).toBe(0);
    expect(counts.truncated).toBe(0);
    expect(counts.blank).toBe(0);
  });
});

describe('readPerfRecords — unknown fields ignored (§2)', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(operationLine({ future_metric_ms: 42 }) + '\n');
  });

  afterEach(() => cleanupFile(filePath));

  it('parses a known-version record carrying an unknown field', async () => {
    const { records, counts } = await readPerfRecords(filePath);
    expect(records).toHaveLength(1);
    expect(counts.parsed).toBe(1);
    expect(counts.malformed).toBe(0);
  });
});

describe('readPerfRecords — future schema version (skip+count)', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(
      operationLine() +
        '\n' +
        JSON.stringify({
          ...JSON.parse(operationLine()),
          schema_version: 99,
          record_type: 'operation',
        }) +
        '\n' +
        operationLine() +
        '\n',
    );
  });

  afterEach(() => cleanupFile(filePath));

  it('skips and counts the future-version record without coercing it', async () => {
    const { records, counts } = await readPerfRecords(filePath);
    expect(records).toHaveLength(2);
    expect(counts.parsed).toBe(2);
    expect(counts.futureVersion).toBe(1);
    expect(counts.malformed).toBe(0);
  });
});

describe('readPerfRecords — malformed complete line', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(
      operationLine() + '\n' + '{not valid json\n' + operationLine() + '\n',
    );
  });

  afterEach(() => cleanupFile(filePath));

  it('counts the malformed line and continues parsing the rest', async () => {
    const { records, counts } = await readPerfRecords(filePath);
    expect(records).toHaveLength(2);
    expect(counts.parsed).toBe(2);
    expect(counts.malformed).toBe(1);
    expect(counts.truncated).toBe(0);
  });
});

describe('readPerfRecords — unversioned legacy record', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(
      operationLine() +
        '\n' +
        JSON.stringify({
          some_legacy_field: 1,
          ts: '2026-01-01T00:00:00.000Z',
        }) +
        '\n',
    );
  });

  afterEach(() => cleanupFile(filePath));

  it('counts the unversioned record rather than fake-normalizing it', async () => {
    const { records, counts } = await readPerfRecords(filePath);
    expect(records).toHaveLength(1);
    expect(counts.parsed).toBe(1);
    expect(counts.unversioned).toBe(1);
    expect(counts.malformed).toBe(0);
  });
});

describe('readPerfRecords — truncated final line (SIGKILL mid-append)', () => {
  it('counts a partial-JSON final line as truncated', async () => {
    // A complete valid line, then a partial JSON line with NO trailing newline.
    const filePath = makeTempFile(
      operationLine() + '\n' + '{"schema_version":1,"record_type":"operation",',
    );
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(1);
      expect(counts.parsed).toBe(1);
      expect(counts.truncated).toBe(1);
      expect(counts.malformed).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });

  it('parses a complete final record that simply lacks a trailing newline', async () => {
    const filePath = makeTempFile(operationLine());
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(1);
      expect(counts.parsed).toBe(1);
      expect(counts.truncated).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });
});

describe('readPerfRecords — blank lines', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(
      '\n' + operationLine() + '\n\n\n' + operationLine() + '\n',
    );
  });

  afterEach(() => cleanupFile(filePath));

  it('skips and counts blank lines without treating them as malformed', async () => {
    const { records, counts } = await readPerfRecords(filePath);
    expect(records).toHaveLength(2);
    expect(counts.parsed).toBe(2);
    expect(counts.blank).toBe(3);
    expect(counts.malformed).toBe(0);
  });

  it('counts a whitespace-only final line without a trailing newline', async () => {
    cleanupFile(filePath);
    filePath = makeTempFile(operationLine() + '\n   ');

    const { records, counts } = await readPerfRecords(filePath);

    expect(records).toHaveLength(1);
    expect(counts.parsed).toBe(1);
    expect(counts.blank).toBe(1);
    expect(counts.truncated).toBe(0);
  });
});

describe('readPerfRecords — mixed real-world fileset (EVIDENCE-AC9)', () => {
  it('reports accurate per-category counters on a mixed file', async () => {
    const futureRecord = JSON.stringify({
      ...JSON.parse(operationLine()),
      schema_version: 5,
    });
    // Complete (newline-terminated) lines, then a final truncated line with
    // NO trailing newline (simulating SIGKILL mid-append).
    const completeLines = [
      operationLine(),
      JSON.stringify({
        some_legacy_field: 1,
        ts: '2026-01-01T00:00:00.000Z',
      }),
      '{broken json',
      operationLine({ status: 'superseded' }),
      futureRecord,
      '',
    ].join('\n');
    const filePath = makeTempFile(
      completeLines +
        '\n' +
        '{"schema_version":1,"record_type":"operation","ts":"tr',
    );
    try {
      const { records, counts } = await readPerfRecords(filePath);
      // Two clean operation records parsed; the rest are counted by category.
      expect(records).toHaveLength(2);
      expect(counts.parsed).toBe(2);
      expect(counts.unversioned).toBe(1);
      expect(counts.malformed).toBe(1);
      expect(counts.futureVersion).toBe(1);
      expect(counts.blank).toBe(1);
      expect(counts.truncated).toBe(1);
      // records only ever contains successfully parsed records
      for (const record of records) {
        expect(record.schema_version).toBe(1);
      }
    } finally {
      cleanupFile(filePath);
    }
  });
});

describe('readPerfRecords — never throws on malformed external JSONL', () => {
  it('does not reject on a file full of garbage', async () => {
    const filePath = makeTempFile('garbage\ngarbage2\n{still bad\n123\n');
    try {
      const result = await readPerfRecords(filePath);
      expect(result.counts.parsed).toBe(0);
      // 123 parses as JSON but is not a perf record → malformed
      expect(result.counts.malformed).toBe(4);
    } finally {
      cleanupFile(filePath);
    }
  });
});

describe('readPerfRecords — empty file', () => {
  it('returns no records and zero counters for an empty file', async () => {
    const filePath = makeTempFile('');
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(0);
      expect(counts.parsed).toBe(0);
      expect(counts.truncated).toBe(0);
      expect(counts.malformed).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });
});

// Issue #3167 (P04): a final line with NO trailing newline must be classified
// by its CONTENT, not by the missing newline. Only a final line that is not
// valid JSON is "truncated" (realistic cause: SIGKILL mid-append). A final
// line that parses as JSON keeps its content classification (future_version,
// unversioned, ok, or malformed for a current-version record missing required
// fields). Each file below has one complete valid record, then the final line
// under test with no trailing newline.
describe('readPerfRecords — final line without trailing newline (issue #3167)', () => {
  it('classifies a final future-version JSON line as future_version, not truncated', async () => {
    const future = JSON.stringify({
      ...JSON.parse(operationLine()),
      schema_version: 99,
    });
    const filePath = makeTempFile(operationLine() + '\n' + future);
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(1);
      expect(counts.parsed).toBe(1);
      expect(counts.futureVersion).toBe(1);
      expect(counts.truncated).toBe(0);
      expect(counts.malformed).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });

  it('classifies a final unversioned JSON line as unversioned, not truncated', async () => {
    const unversioned = JSON.stringify({
      some_legacy_field: 1,
      ts: '2026-01-01T00:00:00.000Z',
    });
    const filePath = makeTempFile(operationLine() + '\n' + unversioned);
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(1);
      expect(counts.parsed).toBe(1);
      expect(counts.unversioned).toBe(1);
      expect(counts.truncated).toBe(0);
      expect(counts.malformed).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });

  it('classifies a final valid-JSON current-version record missing fields as malformed, not truncated', async () => {
    const malformed = JSON.stringify({
      schema_version: 1,
      record_type: 'operation',
    });
    const filePath = makeTempFile(operationLine() + '\n' + malformed);
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(1);
      expect(counts.parsed).toBe(1);
      expect(counts.malformed).toBe(1);
      expect(counts.truncated).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });

  it('classifies a final invalid/partial JSON line as truncated', async () => {
    const partial = '{"schema_version":1,"record_type":"operation",';
    const filePath = makeTempFile(operationLine() + '\n' + partial);
    try {
      const { records, counts } = await readPerfRecords(filePath);
      expect(records).toHaveLength(1);
      expect(counts.parsed).toBe(1);
      expect(counts.truncated).toBe(1);
      expect(counts.malformed).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });
});
