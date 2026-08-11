/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PerfSink, FaultInjectingPerfFilesystem } from './PerfSink.js';
import {
  PerfRetention,
  FaultInjectingRetentionFilesystem,
} from './retention.js';
import type { PerfOperationRecord } from './perfRecords.js';
import {
  PERF_SCHEMA_VERSION,
  PERF_RECORD_TYPE_OPERATION,
} from './perfRecords.js';

function makeOperation(
  overrides: Partial<PerfOperationRecord> = {},
): PerfOperationRecord {
  return {
    schema_version: PERF_SCHEMA_VERSION,
    record_type: PERF_RECORD_TYPE_OPERATION,
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
    `perf-health-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('PerfSink self-health: lastWriteErrorCode (P11)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lastWriteErrorCode is null on clean sink', () => {
    const sink = new PerfSink({ dir, runUuid: 'old' });
    expect(sink.lastWriteErrorCode).toBeNull();
  });

  it('lastWriteErrorCode surfaces filesystem write errors', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: 'old',
      fs: new FaultInjectingPerfFilesystem({
        failMethod: 'appendFile',
        code: 'ENOSPC',
      }),
      onDiagnostic: () => {},
    });

    await sink.write(makeOperation());

    expect(sink.lastWriteErrorCode).toBe('ENOSPC');
  });

  it('lastWriteErrorCode persists across multiple write errors', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: 'old',
      fs: new FaultInjectingPerfFilesystem({
        failMethod: 'appendFile',
        code: 'EACCES',
      }),
      onDiagnostic: () => {},
    });

    await sink.write(makeOperation());
    await sink.write(makeOperation({ operation_id: 'op-2' }));

    expect(sink.lastWriteErrorCode).toBe('EACCES');
  });

  it('does not add records_dropped counter', () => {
    const sink = new PerfSink({ dir, runUuid: 'old' });

    expect('recordsDropped' in sink).toBe(false);
    expect('records_dropped' in sink).toBe(false);
  });
});

describe('PerfRetention self-health: evictionCount (P11)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('evictionCount is 0 on clean retention', () => {
    const retention = new PerfRetention({
      dir,
      runUuid: 'old',
    });
    expect(retention.evictionCount).toBe(0);
  });

  it('evictionCount increments on successful eviction', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-0000000000cc',
      maxFiles: 1,
    });

    await retention.start();

    const oldName = 'perf-20250101-old.jsonl';
    await fs.writeFile(join(dir, oldName), '{"v":1}\n');

    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fs.utimes(join(dir, oldName), oldTime, oldTime);

    await retention.maintain(Date.now());

    expect(retention.evictionCount).toBeGreaterThan(0);

    await retention.dispose();
  });

  it('evictionCount does not increment on failed unlinks (fail open)', async () => {
    const diagnostics: string[] = [];
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-0000000000cd',
      fs: new FaultInjectingRetentionFilesystem({
        failMethod: 'unlink',
        code: 'EACCES',
      }),
      maxFiles: 1,
      maxBytes: 1,
      onDiagnostic: (message) => diagnostics.push(message),
    });

    const oldName = 'perf-20250101-00000000-0000-4000-8000-0000000000ef.jsonl';
    await fs.writeFile(join(dir, oldName), '{"v":1}\n');
    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fs.utimes(join(dir, oldName), oldTime, oldTime);

    const beforeCount = retention.evictionCount;
    await retention.maintain(Date.now());

    expect(retention.evictionCount).toBe(beforeCount);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('EACCES');
    expect((await fs.stat(join(dir, oldName))).isFile()).toBe(true);

    await retention.dispose();
  });

  it('does not add records_dropped counter', () => {
    const retention = new PerfRetention({
      dir,
      runUuid: 'old',
    });
    expect('recordsDropped' in retention).toBe(false);
    expect('records_dropped' in retention).toBe(false);
  });
});
