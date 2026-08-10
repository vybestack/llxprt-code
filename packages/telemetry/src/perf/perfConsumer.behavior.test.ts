/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  consumePerfDirectory,
  streamFileTolerant,
  streamPerfDirectory,
} from './perfConsumer.js';
import type { PerfOperationRecord, PerfStreamEntry } from './perfRecords.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOperation(
  overrides: Partial<PerfOperationRecord> = {},
): PerfOperationRecord {
  return {
    schema_version: 1,
    record_type: 'operation',
    ts: '2026-01-01T00:00:00.000Z',
    session_id: 'sess-1',
    operation_id: 'op-1',
    runtime_id: 'rt-1',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'hash-1',
    llxprt_version: '0.10.0',
    git_sha: 'abc1234',
    runtime: 'cli',
    platform: 'darwin',
    provider: 'test-provider',
    model: 'test-model',
    context_tokens: 1000,
    output_tokens: 500,
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'ink',
    concurrent_instances: 1,
    status: 'completed',
    client_prepare_ms: 10,
    stream_handler_ms: 100,
    ink_render_ms: 5,
    ink_render_count: 3,
    stdout_bytes: 1024,
    stdout_write_calls: 5,
    stdout_write_sync_ms: 2,
    client_finalize_ms: 8,
    provider_attempts: 1,
    provider_attempt_sum_ms: 200,
    provider_union_ms: 200,
    tool_calls: 2,
    tool_call_sum_ms: 50,
    tool_union_ms: 50,
    agent_activity_union_ms: 250,
    operation_elapsed_ms: 1000,
    approval_wait_ms: 0,
    unclassified_elapsed_ms: 0,
    session_operation_index: 0,
    uptime_ms: 5000,
    ...overrides,
  };
}

async function makeTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `perf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeJsonl(
  dir: string,
  name: string,
  lines: string[],
): Promise<void> {
  const content = lines.join('\n');
  await fs.writeFile(
    join(dir, name),
    content + (content.endsWith('\n') ? '' : '\n'),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PerfConsumer (P11, AC-9)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('parses valid v1 operation records from sorted perf files', async () => {
    const op1 = makeOperation({
      operation_id: 'op-1',
      session_operation_index: 0,
    });
    const op2 = makeOperation({
      operation_id: 'op-2',
      session_operation_index: 1,
    });
    await writeJsonl(dir, 'perf-20260101-aaaa1111.jsonl', [
      JSON.stringify(op1),
      JSON.stringify(op2),
    ]);

    const { entries, counts } = await consumePerfDirectory(dir);

    const okEntries = entries.filter((e) => e.entry.kind === 'ok');
    expect(okEntries).toHaveLength(2);
    expect(counts.parsed).toBe(2);
    expect(counts.files).toBe(1);
    expect(counts.bytes).toBeGreaterThan(0);
  });

  it('includes source file and run UUID identity in entries', async () => {
    const op = makeOperation();
    await writeJsonl(dir, 'perf-20260101-deadbeef.jsonl', [JSON.stringify(op)]);

    const { entries } = await consumePerfDirectory(dir);
    const okEntry = entries.find((e) => e.entry.kind === 'ok');

    expect(okEntry).toBeDefined();
    expect(okEntry!.sourceFile).toBe('perf-20260101-deadbeef.jsonl');
    expect(okEntry!.runUuid).toBe('deadbeef');
  });

  it('reads files in sorted order (file streaming, one at a time)', async () => {
    await writeJsonl(dir, 'perf-20260101-zzzz.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 'from-z' })),
    ]);
    await writeJsonl(dir, 'perf-20260101-aaaa.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 'from-a' })),
    ]);

    const order: string[] = [];
    for await (const entry of streamPerfDirectory(dir)) {
      if (
        entry.entry.kind === 'ok' &&
        entry.entry.record.record_type === 'operation'
      ) {
        order.push(entry.sourceFile);
      }
    }

    // Sorted: aaaa before zzzz
    expect(order).toEqual([
      'perf-20260101-aaaa.jsonl',
      'perf-20260101-zzzz.jsonl',
    ]);
  });

  it('missing directory is an empty dataset (not an error)', async () => {
    const { entries, counts } = await consumePerfDirectory(
      join(dir, 'does-not-exist'),
    );

    expect(entries).toHaveLength(0);
    expect(counts.parsed).toBe(0);
    expect(counts.files).toBe(0);
    expect(counts.bytes).toBe(0);
  });

  it('skips and counts future version (v999) records', async () => {
    await writeJsonl(dir, 'perf-20260101-futr.jsonl', [
      JSON.stringify({
        ...makeOperation(),
        schema_version: 999,
      }),
    ]);

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.futureVersion).toBe(1);
    expect(counts.parsed).toBe(0);
  });

  it('skips and counts unversioned records (no schema_version or record_type)', async () => {
    await writeJsonl(dir, 'perf-20260101-unv.jsonl', [
      JSON.stringify({ foo: 'bar', baz: 42 }),
    ]);

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.unversioned).toBe(1);
    expect(counts.parsed).toBe(0);
  });

  it('skips and counts malformed JSON lines', async () => {
    await writeJsonl(dir, 'perf-20260101-bad.jsonl', [
      '{ this is not valid json',
      JSON.stringify(makeOperation()),
    ]);

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.malformed).toBe(1);
    expect(counts.parsed).toBe(1);
  });

  it('counts truncated final line (no trailing newline, unparseable)', async () => {
    // Write a valid record, then a partial unterminated line without trailing newline
    const valid = JSON.stringify(makeOperation());
    const partial = '{"schema_version":1,"record_type":"operation","ts":"2026';
    await fs.writeFile(
      join(dir, 'perf-20260101-trunc.jsonl'),
      valid + '\n' + partial, // no trailing newline on partial
      'utf8',
    );

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.parsed).toBe(1);
    expect(counts.truncated).toBe(1);
  });

  it('counts blank lines', async () => {
    await writeJsonl(dir, 'perf-20260101-blank.jsonl', [
      '',
      '   ',
      JSON.stringify(makeOperation()),
    ]);

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.blank).toBe(2);
    expect(counts.parsed).toBe(1);
  });

  it('does not parse claim files', async () => {
    await writeJsonl(dir, 'perf-20260101-data.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    // Write a claim file that looks like it could be parsed
    await fs.writeFile(join(dir, 'someuuid.claim'), '', 'utf8');

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.files).toBe(1); // only perf-*.jsonl
    expect(counts.parsed).toBe(1);
  });

  it('aggregates counts across multiple files', async () => {
    await writeJsonl(dir, 'perf-20260101-aaa.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 'a1' })),
      'bad json',
    ]);
    await writeJsonl(dir, 'perf-20260102-bbb.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 'b1' })),
      JSON.stringify({ foo: 'unversioned' }),
      JSON.stringify({
        ...makeOperation(),
        schema_version: 999,
      }),
    ]);

    const { counts } = await consumePerfDirectory(dir);

    expect(counts.files).toBe(2);
    expect(counts.parsed).toBe(2);
    expect(counts.malformed).toBe(1);
    expect(counts.unversioned).toBe(1);
    expect(counts.futureVersion).toBe(1);
  });

  it('streamPerfDirectory yields entries lazily (before reading all files)', async () => {
    await writeJsonl(dir, 'perf-20260101-stream.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 's1' })),
      JSON.stringify(makeOperation({ operation_id: 's2' })),
    ]);

    let firstYield = false;
    for await (const entry of streamPerfDirectory(dir)) {
      if (entry.entry.kind === 'ok') {
        firstYield = true;
        break; // prove we can break early (lazy iteration)
      }
    }

    expect(firstYield).toBe(true);
  });

  it('tolerates a file evicted (ENOENT) during streaming without aborting the directory', async () => {
    const opA = makeOperation({ operation_id: 'op-a' });
    const opB = makeOperation({ operation_id: 'op-b' });
    const fileA = 'perf-20260101-aaaa.jsonl';
    const fileB = 'perf-20260101-zzzz.jsonl';
    await writeJsonl(dir, fileA, [JSON.stringify(opA)]);
    await writeJsonl(dir, fileB, [JSON.stringify(opB)]);

    const ids: string[] = [];
    let evictedB = false;
    for await (const entry of streamPerfDirectory(dir)) {
      if (
        entry.entry.kind === 'ok' &&
        entry.entry.record.record_type === 'operation'
      ) {
        ids.push(entry.entry.record.operation_id);
      }
      if (!evictedB) {
        await fs.rm(join(dir, fileB), { force: true });
        evictedB = true;
      }
    }

    expect(evictedB).toBe(true);
    expect(ids).toEqual(['op-a']);
  });

  it('tolerates ENOENT when a statted file is deleted before stream open', async () => {
    const filePath = join(dir, 'perf-20260101-open-race.jsonl');
    await writeJsonl(dir, 'perf-20260101-open-race.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    await fs.stat(filePath);

    const iterator = streamFileTolerant(filePath);
    await fs.rm(filePath);

    expect((await iterator.next()).done).toBe(true);
  });

  it('propagates non-ENOENT stream errors', async () => {
    const denied = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    async function* deniedStream(): AsyncGenerator<never> {
      yield Promise.reject(denied);
    }

    await expect(
      streamFileTolerant('unused', deniedStream).next(),
    ).rejects.toBe(denied);
  });

  it('closes the underlying stream when its consumer stops early', async () => {
    let closed = 0;
    async function* source(): AsyncGenerator<PerfStreamEntry> {
      try {
        yield { kind: 'blank' };
        yield { kind: 'blank' };
      } finally {
        closed += 1;
      }
    }

    const stream = streamFileTolerant('unused', source);
    expect((await stream.next()).done).toBe(false);
    await stream.return(undefined);

    expect(closed).toBe(1);
  });
});
