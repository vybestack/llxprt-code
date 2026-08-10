/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the genuinely streaming perf JSONL reader (P04A
 * correction B).
 *
 * The streaming API must emit parsed records / classification outcomes
 * incrementally — it must NOT accumulate the entire file in memory before
 * yielding the first entry. P11 must be able to use this API for a 24/7 file
 * that never closes.
 *
 * All tests use real files and the package-private readable-stream seam —
 * no source-text assertions, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';
import { streamPerfRecords, type PerfStreamEntry } from './perfRecords.js';
// The controlled-readable seam is package-private (not exported from
// package.json); same-package tests import it directly from the internal module.
import { streamPerfFromReadable } from './perfRecordsStream.js';

// ---------------------------------------------------------------------------
// Temp-file helper
// ---------------------------------------------------------------------------

function makeTempFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-stream-'));
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
// Valid record factory
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

// ---------------------------------------------------------------------------
// streamPerfRecords — real file iteration
// ---------------------------------------------------------------------------

describe('streamPerfRecords — real file', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTempFile(
      [operationLine(), operationLine(), operationLine()].join('\n') + '\n',
    );
  });

  afterEach(() => cleanupFile(filePath));

  it('yields one ok entry per valid record', async () => {
    const entries: PerfStreamEntry[] = [];
    for await (const entry of streamPerfRecords(filePath)) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.kind).toBe('ok');
    }
  });

  it('yields classification outcomes for non-ok lines', async () => {
    const tmpFile = makeTempFile(
      operationLine() +
        '\n' +
        '{not valid json\n' +
        JSON.stringify({ ...JSON.parse(operationLine()), schema_version: 99 }) +
        '\n' +
        operationLine() +
        '\n',
    );
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }
      const kinds = entries.map((e) => e.kind);
      expect(kinds).toEqual(['ok', 'malformed', 'future_version', 'ok']);
    } finally {
      cleanupFile(tmpFile);
    }
  });

  it('handles an empty file', async () => {
    const empty = makeTempFile('');
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(empty)) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(0);
    } finally {
      cleanupFile(empty);
    }
  });

  it('yields a whitespace-only final line without a trailing newline as blank', async () => {
    const tmpFile = makeTempFile('   ');
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }

      expect(entries).toEqual([{ kind: 'blank' }]);
    } finally {
      cleanupFile(tmpFile);
    }
  });

  it('classifies a truncated final line as truncated', async () => {
    const tmpFile = makeTempFile(
      operationLine() + '\n' + '{"schema_version":1,"record_type":"operation",',
    );
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }
      expect(entries.map((e) => e.kind)).toEqual(['ok', 'truncated']);
    } finally {
      cleanupFile(tmpFile);
    }
  });
});

// Issue #3167 (P04): a final line with NO trailing newline keeps its CONTENT
// classification. Only a final line that is not valid JSON is "truncated".
// A final line that parses as JSON keeps future_version / unversioned /
// malformed. Each file below has one complete valid record, then the final
// line under test with no trailing newline.
describe('streamPerfRecords — final line without trailing newline classification (issue #3167)', () => {
  it('yields future_version for a final future-version JSON line without a newline', async () => {
    const future = JSON.stringify({
      ...JSON.parse(operationLine()),
      schema_version: 99,
    });
    const tmpFile = makeTempFile(operationLine() + '\n' + future);
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }
      expect(entries.map((e) => e.kind)).toEqual(['ok', 'future_version']);
    } finally {
      cleanupFile(tmpFile);
    }
  });

  it('yields unversioned for a final unversioned JSON line without a newline', async () => {
    const unversioned = JSON.stringify({
      some_legacy_field: 1,
      ts: '2026-01-01T00:00:00.000Z',
    });
    const tmpFile = makeTempFile(operationLine() + '\n' + unversioned);
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }
      expect(entries.map((e) => e.kind)).toEqual(['ok', 'unversioned']);
    } finally {
      cleanupFile(tmpFile);
    }
  });

  it('yields malformed for a final valid-JSON current-version record missing fields without a newline', async () => {
    const malformed = JSON.stringify({
      schema_version: 1,
      record_type: 'operation',
    });
    const tmpFile = makeTempFile(operationLine() + '\n' + malformed);
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }
      expect(entries.map((e) => e.kind)).toEqual(['ok', 'malformed']);
    } finally {
      cleanupFile(tmpFile);
    }
  });

  it('yields truncated for a final invalid/partial JSON line without a newline', async () => {
    const partial = '{"schema_version":1,"record_type":"operation",';
    const tmpFile = makeTempFile(operationLine() + '\n' + partial);
    try {
      const entries: PerfStreamEntry[] = [];
      for await (const entry of streamPerfRecords(tmpFile)) {
        entries.push(entry);
      }
      expect(entries.map((e) => e.kind)).toEqual(['ok', 'truncated']);
    } finally {
      cleanupFile(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// streamPerfFromReadable — incremental yield proof
// ---------------------------------------------------------------------------

describe('streamPerfFromReadable — incremental yield proof', () => {
  it('yields the first record before the second chunk is pushed', async () => {
    const line1 = operationLine({ session_operation_index: 1 }) + '\n';
    const line2 = operationLine({ session_operation_index: 2 }) + '\n';

    // A manually-controlled readable. We push chunks one at a time and verify
    // the iterator yields from chunk 1 before chunk 2 is even available.
    const readable = new Readable({ read() {} });

    const iter = streamPerfFromReadable(readable);

    // Push first chunk only.
    readable.push(Buffer.from(line1));

    // Pull the first entry — it MUST resolve from chunk 1 alone.
    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value?.kind).toBe('ok');
    if (first.value?.kind !== 'ok') throw new Error('unreachable');
    expect(first.value.record.record_type).toBe('operation');

    // NOW push the second chunk and close the stream.
    readable.push(Buffer.from(line2));
    readable.push(null);

    const second = await iter.next();
    expect(second.done).toBe(false);
    expect(second.value?.kind).toBe('ok');

    const third = await iter.next();
    expect(third.done).toBe(true);
  });

  it('correctly processes a large file with many records', async () => {
    // Create a real large file (many records).
    const N = 5000;
    const lines: string[] = [];
    for (let i = 0; i < N; i++) {
      lines.push(operationLine({ session_operation_index: i }));
    }
    const filePath = makeTempFile(lines.join('\n') + '\n');
    try {
      let count = 0;
      let firstIndex = -1;
      for await (const entry of streamPerfRecords(filePath)) {
        if (entry.kind !== 'ok') continue;
        count++;
        if (count === 1 && entry.record.record_type === 'operation') {
          firstIndex = entry.record.session_operation_index;
        }
      }
      expect(count).toBe(N);
      expect(firstIndex).toBe(0);
    } finally {
      cleanupFile(filePath);
    }
  });

  it('proves streaming by interleaving pushes and pulls', async () => {
    // Push 3 lines one at a time, pulling between each push.
    const readable = new Readable({ read() {} });
    const iter = streamPerfFromReadable(readable);

    for (let i = 0; i < 3; i++) {
      readable.push(
        Buffer.from(operationLine({ session_operation_index: i }) + '\n'),
      );
      const result = await iter.next();
      expect(result.done).toBe(false);
      expect(result.value?.kind).toBe('ok');
    }

    readable.push(null);
    const done = await iter.next();
    expect(done.done).toBe(true);
  });
});
