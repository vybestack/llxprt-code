/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { perfInspect, formatInspect } from './perfInspect.js';
import type {
  PerfOperationRecord,
  PerfMemorySampleRecord,
} from './perfRecords.js';

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

function makeMemorySample(
  overrides: Partial<PerfMemorySampleRecord> = {},
): PerfMemorySampleRecord {
  return {
    schema_version: 1,
    record_type: 'memory_sample',
    ts: '2026-01-01T00:01:00.000Z',
    rss_bytes: 50_000_000,
    heap_used_bytes: 20_000_000,
    external_bytes: 5_000_000,
    array_buffers_bytes: 1_000_000,
    uptime_ms: 60_000,
    ms_since_last_operation: 30_000,
    ...overrides,
  };
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'perf-inspect-'));
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

describe('PerfInspect (P11, AC-9)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns dir, schema version, and privacy statement', async () => {
    const result = await perfInspect(dir);

    expect(result.dir).toBe(dir);
    expect(result.schemaVersion).toBe(1);
    expect(result.privacy.localOnly).toBe(true);
    expect(result.privacy.defaultOff).toBe(true);
    expect(result.privacy.noUpload).toBe(true);
    expect(result.privacy.memorySeparatelyOptIn).toBe(true);
  });

  it('counts owned JSONL files and total bytes', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    await writeJsonl(dir, 'perf-20260102-run2.jsonl', [
      JSON.stringify(makeOperation()),
    ]);

    const result = await perfInspect(dir);

    expect(result.fileCount).toBe(2);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('counts operations and memory samples separately', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
      JSON.stringify(makeOperation({ operation_id: 'op-2' })),
      JSON.stringify(makeMemorySample()),
      JSON.stringify(makeMemorySample({ ts: '2026-01-01T00:02:00.000Z' })),
    ]);

    const result = await perfInspect(dir);

    expect(result.operationCount).toBe(2);
    expect(result.memorySampleCount).toBe(2);
  });

  it('includes tolerant skipped breakdown', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
      'bad json',
      JSON.stringify({
        ...makeOperation(),
        schema_version: 999,
      }),
      JSON.stringify({ unknown: 'shape' }),
    ]);

    const result = await perfInspect(dir);

    expect(result.skipped.malformed).toBe(1);
    expect(result.skipped.futureVersion).toBe(1);
    expect(result.skipped.unversioned).toBe(1);
    expect(result.counts.parsed).toBe(1);
  });

  it('counts claim files', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    await fs.writeFile(join(dir, 'uuid-aaa.claim'), '', 'utf8');
    await fs.writeFile(join(dir, 'uuid-bbb.claim'), '', 'utf8');

    const result = await perfInspect(dir);

    expect(result.claimCount).toBe(2);
  });

  it('missing directory returns zero counts (empty dataset)', async () => {
    const result = await perfInspect(join(dir, 'does-not-exist'));

    expect(result.fileCount).toBe(0);
    expect(result.totalBytes).toBe(0);
    expect(result.operationCount).toBe(0);
    expect(result.memorySampleCount).toBe(0);
    expect(result.claimCount).toBe(0);
  });

  it('formatter includes all key fields', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    await fs.writeFile(join(dir, 'uuid.claim'), '', 'utf8');

    const result = await perfInspect(dir);
    const text = formatInspect(result);

    expect(text).toContain('Perf Inspect');
    expect(text).toContain('Directory:');
    expect(text).toContain('Schema version:');
    expect(text).toContain('Privacy:');
    expect(text).toContain('local-only');
    expect(text).toContain('default-off');
    expect(text).toContain('memory collection separately opt-in');
    expect(text).toContain('Owned JSONL files:');
    expect(text).toContain('Claim files:');
    expect(text).toContain('operations:');
    expect(text).toContain('memory samples:');
    expect(text).toContain('Skipped breakdown:');
  });
});
