/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving the live self-health report model distinguishes
 * process-local health facts that are UNAVAILABLE (not supplied) from known
 * null/zero values (issue #3167 review finding C).
 *
 * Reader health (skipped/truncated) always derives from consumer counts.
 * Process-local health (lastWriteErrorCode/evictionCount) is unavailable
 * (undefined) when not supplied, distinguishing:
 *   - undefined = process-local health not wired (CLI default-off / batch read)
 *   - null      = known: last write succeeded (no error)
 *   - '<code>'  = known: last write failed with this errno code
 *   - 0         = known: zero evictions
 *
 * Uses real buildReport/assembleReport/formatReport with real temp files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReport, assembleReport, formatReport } from './perfReport.js';
import type { PerfOperationRecord } from './perfRecords.js';

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
    `perf-health-model-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe('Self-health report model (finding C)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // --- Process-local health is UNAVAILABLE when not supplied ---

  it('lastWriteErrorCode is undefined (unavailable) when not supplied', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir);
    expect(report.selfHealth.lastWriteErrorCode).toBeUndefined();
  });

  it('evictionCount is undefined (unavailable) when not supplied', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir);
    expect(report.selfHealth.evictionCount).toBeUndefined();
  });

  // --- Known null/zero are distinguished from unavailable ---

  it('supplied null lastWriteErrorCode is preserved as known-no-error', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir, undefined, {
      lastWriteErrorCode: null,
    });
    expect(report.selfHealth.lastWriteErrorCode).toBeNull();
    expect(report.selfHealth.lastWriteErrorCode).not.toBeUndefined();
  });

  it('supplied zero evictionCount is preserved as known-zero', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir, undefined, { evictionCount: 0 });
    expect(report.selfHealth.evictionCount).toBe(0);
    expect(report.selfHealth.evictionCount).not.toBeUndefined();
  });

  it('supplied error code and nonzero evictionCount are preserved', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir, undefined, {
      lastWriteErrorCode: 'ENOSPC',
      evictionCount: 3,
    });
    expect(report.selfHealth.lastWriteErrorCode).toBe('ENOSPC');
    expect(report.selfHealth.evictionCount).toBe(3);
  });

  // --- Reader health always derives from consumer counts ---

  it('skipped and truncated always derive from consumer counts', async () => {
    await writeJsonl(dir, 'perf-20260101-mixed.jsonl', [
      JSON.stringify(makeOperation()),
      'broken json',
    ]);
    const report = await buildReport(dir);
    expect(report.selfHealth.skipped).toBe(1); // 1 malformed
    expect(report.selfHealth.truncated).toBe(0);
  });

  it('supplied skipped/truncated override consumer-derived defaults', async () => {
    await writeJsonl(dir, 'perf-20260101-mixed.jsonl', [
      JSON.stringify(makeOperation()),
      'broken json',
    ]);
    const report = await buildReport(dir, undefined, {
      skipped: 99,
      truncated: 7,
    });
    expect(report.selfHealth.skipped).toBe(99);
    expect(report.selfHealth.truncated).toBe(7);
  });

  // --- Formatter reflects the three-state model ---

  it('formatter shows unavailable for last write error when not supplied', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir);
    const text = formatReport(report);
    expect(text).toContain('last write error: unavailable');
  });

  it('formatter shows unavailable for evictions when not supplied', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir);
    const text = formatReport(report);
    expect(text).toContain('evictions: unavailable');
  });

  it('formatter shows none for known-null last write error', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir, undefined, {
      lastWriteErrorCode: null,
    });
    const text = formatReport(report);
    expect(text).toContain('last write error: none');
  });

  it('formatter shows the count for known evictionCount', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir, undefined, { evictionCount: 5 });
    const text = formatReport(report);
    expect(text).toContain('evictions: 5');
  });

  it('formatter shows the code for known lastWriteErrorCode', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    const report = await buildReport(dir, undefined, {
      lastWriteErrorCode: 'EACCES',
    });
    const text = formatReport(report);
    expect(text).toContain('last write error: EACCES');
  });

  // --- assembleReport also reflects the model ---

  it('assembleReport: undefined process-local health when selfHealth omitted', () => {
    const counts = {
      parsed: 0,
      malformed: 0,
      futureVersion: 0,
      unversioned: 0,
      truncated: 0,
      blank: 0,
      files: 0,
      bytes: 0,
    };
    const report = assembleReport([], new Map(), counts, undefined);
    expect(report.selfHealth.lastWriteErrorCode).toBeUndefined();
    expect(report.selfHealth.evictionCount).toBeUndefined();
  });
});
