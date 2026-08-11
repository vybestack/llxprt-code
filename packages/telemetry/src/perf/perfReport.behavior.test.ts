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
  buildReport,
  formatReport,
  joinTokenRowsByOperation,
} from './perfReport.js';
import type { PerfOperationRecord } from './perfRecords.js';

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
    `perf-report-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe('PerfReport (P11, AC-9, D7)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // --- Grouping and dimensions ---

  it('groups by build identity within exact dimensions', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          provider: 'p1',
          model: 'm1',
          render_mode: 'ink',
          terminal_cols: 80,
          terminal_rows: 24,
          operation_elapsed_ms: 1000,
        }),
      ),
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          provider: 'p1',
          model: 'm1',
          render_mode: 'ink',
          terminal_cols: 80,
          terminal_rows: 24,
          operation_elapsed_ms: 2000,
        }),
      ),
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'bbb',
          provider: 'p1',
          model: 'm1',
          render_mode: 'ink',
          terminal_cols: 80,
          terminal_rows: 24,
          operation_elapsed_ms: 3000,
        }),
      ),
    ]);

    const report = await buildReport(dir);

    expect(report.groups).toHaveLength(2);
    // Same dimensions, different builds → 2 groups
    const g1 = report.groups.find((g) => g.build.git_sha === 'aaa');
    const g2 = report.groups.find((g) => g.build.git_sha === 'bbb');
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    expect(g1!.sampleCount).toBe(2);
    expect(g2!.sampleCount).toBe(1);
  });

  it('never pools groups with different dimensions', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          provider: 'p1',
          model: 'm1',
          render_mode: 'ink',
          terminal_cols: 80,
          terminal_rows: 24,
        }),
      ),
      JSON.stringify(
        makeOperation({
          provider: 'p2', // different provider
          model: 'm1',
          render_mode: 'ink',
          terminal_cols: 80,
          terminal_rows: 24,
        }),
      ),
      JSON.stringify(
        makeOperation({
          provider: 'p1',
          model: 'm2', // different model
          render_mode: 'ink',
          terminal_cols: 80,
          terminal_rows: 24,
        }),
      ),
    ]);

    const report = await buildReport(dir);

    expect(report.groups).toHaveLength(3);
  });

  // --- p50 ---

  it('computes p50 (median) for recorded metrics', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 100,
          session_operation_index: 0,
        }),
      ),
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 200,
          session_operation_index: 1,
        }),
      ),
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 300,
          session_operation_index: 2,
        }),
      ),
    ]);

    const report = await buildReport(dir);
    const group = report.groups[0];

    // p50 of [100, 200, 300] = 200 (odd count → middle)
    expect(group.p50.operation_elapsed_ms).toBe(200);
    expect(group.p50.client_prepare_ms).toBe(10);
  });

  // --- Contamination ---

  it('counts contaminated samples (concurrent_instances >= 2, NOT contended)', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({ concurrent_instances: 1, operation_id: 'op-1' }),
      ),
      JSON.stringify(
        makeOperation({ concurrent_instances: 2, operation_id: 'op-2' }),
      ),
      JSON.stringify(
        makeOperation({ concurrent_instances: 3, operation_id: 'op-3' }),
      ),
    ]);

    const report = await buildReport(dir);
    const group = report.groups[0];

    expect(group.sampleCount).toBe(3);
    expect(group.contaminatedSampleCount).toBe(2);
  });

  // --- Terminal status counts ---

  it('counts terminal statuses', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({ status: 'completed', operation_id: 'op-1' }),
      ),
      JSON.stringify(
        makeOperation({ status: 'completed', operation_id: 'op-2' }),
      ),
      JSON.stringify(makeOperation({ status: 'error', operation_id: 'op-3' })),
      JSON.stringify(
        makeOperation({
          status: 'cancelled_during_tool',
          operation_id: 'op-4',
        }),
      ),
    ]);

    const report = await buildReport(dir);
    const group = report.groups[0];

    expect(group.terminalStatusCounts.completed).toBe(2);
    expect(group.terminalStatusCounts.error).toBe(1);
    expect(group.terminalStatusCounts.cancelled_during_tool).toBe(1);
    expect(group.terminalStatusCounts.cancelled_before_send).toBe(0);
  });

  // --- No baseline → no delta ---

  it('without baseline: no delta properties or labels', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation({ operation_elapsed_ms: 1000 })),
    ]);

    const report = await buildReport(dir);

    expect(report.baseline).toBeNull();
    for (const group of report.groups) {
      expect(group.baselineComparison).toBeUndefined();
      expect(group.isBaseline).toBe(false);
    }

    // Formatter: no delta text
    const text = formatReport(report);
    expect(text).not.toContain('delta');
    expect(text).not.toContain('Baseline:');
  });

  // --- Baseline by version ---

  it('with baseline by exact version: matched-dimension deltas', async () => {
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          operation_elapsed_ms: 1000,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-new.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'bbb',
          operation_elapsed_ms: 1500,
        }),
      ),
    ]);

    const report = await buildReport(dir, '0.10.0');

    expect(report.baseline).not.toBeNull();
    expect(report.baseline!.found).toBe(true);
    expect(report.baseline!.value).toBe('0.10.0');

    const newGroup = report.groups.find(
      (g) => g.build.llxprt_version === '0.11.0',
    );
    expect(newGroup).toBeDefined();
    expect(newGroup!.isBaseline).toBe(false);
    expect(newGroup!.baselineComparison).toBeDefined();
    expect(newGroup!.baselineComparison!.matched).toBe(true);
    // Delta: 1500 - 1000 = +500 (50%)
    const delta = newGroup!.baselineComparison!.deltas!['operation_elapsed_ms'];
    expect(delta.absolute).toBe(500);
    expect(delta.percent).toBe(50);
  });

  // --- Baseline by sha ---

  it('with baseline by exact sha: matched-dimension deltas', async () => {
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa111',
          operation_elapsed_ms: 800,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-new.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'bbb222',
          operation_elapsed_ms: 400,
        }),
      ),
    ]);

    const report = await buildReport(dir, 'aaa111');

    expect(report.baseline!.found).toBe(true);
    const newGroup = report.groups.find((g) => g.build.git_sha === 'bbb222');
    expect(newGroup!.baselineComparison!.matched).toBe(true);
    // Delta: 400 - 800 = -400 (-50%)
    const delta = newGroup!.baselineComparison!.deltas!['operation_elapsed_ms'];
    expect(delta.absolute).toBe(-400);
    expect(delta.percent).toBe(-50);
  });

  // --- Unmatched groups (different dimensions) ---

  it('unmatched baseline groups (different dimensions) are explicitly unmatched', async () => {
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          provider: 'p1',
          model: 'm1',
          operation_elapsed_ms: 1000,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-new.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'bbb',
          provider: 'p2', // different dimensions → unmatched
          model: 'm1',
          operation_elapsed_ms: 1500,
        }),
      ),
    ]);

    const report = await buildReport(dir, '0.10.0');

    const newGroup = report.groups.find(
      (g) => g.build.llxprt_version === '0.11.0',
    );
    expect(newGroup!.baselineComparison).toBeDefined();
    expect(newGroup!.baselineComparison!.matched).toBe(false);
    expect(newGroup!.baselineComparison!.deltas).toBeUndefined();
  });

  // --- Selector matches no records (baseline not found) ---

  it('baseline not found is represented explicitly', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
        }),
      ),
    ]);

    const report = await buildReport(dir, '9.9.9');

    expect(report.baseline).not.toBeNull();
    expect(report.baseline!.found).toBe(false);
    // All groups are non-baseline, none matched
    for (const group of report.groups) {
      expect(group.isBaseline).toBe(false);
      expect(group.baselineComparison).toBeDefined();
      expect(group.baselineComparison!.matched).toBe(false);
    }
  });

  // --- No operation records → explicit representation ---

  it('empty directory produces zero groups and counts', async () => {
    const report = await buildReport(dir);

    expect(report.groups).toHaveLength(0);
    expect(report.counts.parsed).toBe(0);
    expect(report.counts.files).toBe(0);

    const text = formatReport(report);
    expect(text).toContain('No operation records found.');
  });

  // --- Percent delta avoids division by zero ---

  it('percent delta is null when baseline p50 is zero', async () => {
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          tool_calls: 0,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-new.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'bbb',
          tool_calls: 5,
        }),
      ),
    ]);

    const report = await buildReport(dir, '0.10.0');
    const newGroup = report.groups.find((g) => g.build.git_sha === 'bbb');
    const delta = newGroup!.baselineComparison!.deltas!['tool_calls'];

    expect(delta.absolute).toBe(5);
    expect(delta.percent).toBeNull(); // base was 0 → avoid div by zero
  });

  // --- Per-file memory slopes ---

  it('computes per-file memory slopes from P10 functions', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: 'op-1',
          session_operation_index: 0,
          rss_bytes: 50_000_000,
          heap_used_bytes: 20_000_000,
          external_bytes: 5_000_000,
          array_buffers_bytes: 1_000_000,
        }),
      ),
      JSON.stringify(
        makeOperation({
          operation_id: 'op-2',
          session_operation_index: 1,
          rss_bytes: 60_000_000,
          heap_used_bytes: 25_000_000,
          external_bytes: 5_000_000,
          array_buffers_bytes: 1_000_000,
        }),
      ),
    ]);

    const report = await buildReport(dir);
    const group = report.groups[0];

    expect(group.memorySlopes).toHaveLength(1);
    const slopes = group.memorySlopes[0];
    expect(slopes.sourceFile).toBe('perf-20260101-run1.jsonl');
    expect(slopes.runUuid).toBe('run1');
    // Slope should be positive (growing memory)
    expect(slopes.perOperation.rss_bytes_per_operation).not.toBeNull();
    expect(slopes.perOperation.rss_bytes_per_operation! > 0).toBe(true);
  });

  // --- Formatter stability ---

  it('formatter produces stable deterministic output', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation({ operation_elapsed_ms: 1000 })),
    ]);

    const report1 = await buildReport(dir);
    const report2 = await buildReport(dir);

    expect(formatReport(report1)).toBe(formatReport(report2));
  });

  it('formatter includes counts and self-health', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
      'bad json line',
    ]);

    const report = await buildReport(dir);
    const text = formatReport(report);

    expect(text).toContain('Files scanned:');
    expect(text).toContain('Records:');
    expect(text).toContain('Self-health:');
    expect(text).toContain('skipped:');
    expect(text).toContain('malformed=1');
  });

  // --- D1 read-time join ---

  it('D1: joinTokenRowsByOperation collapses continuation rows to one operation', () => {
    const rows = [
      { promptId: 'abc-123', actualPromptTokens: 1000 },
      { promptId: 'abc-123#continuation#1', actualPromptTokens: 2000 },
      { promptId: 'abc-123#continuation#2', actualPromptTokens: 3000 },
      { promptId: 'def-456', actualPromptTokens: 5000 },
    ];

    const joined = joinTokenRowsByOperation(rows);

    expect(joined.size).toBe(2);
    expect(joined.get('abc-123')).toHaveLength(3);
    expect(joined.get('def-456')).toHaveLength(1);
  });

  it('D1: initial prompt id (no continuation marker) is returned unchanged', () => {
    const rows = [{ promptId: 'simple-id', actualPromptTokens: 100 }];
    const joined = joinTokenRowsByOperation(rows);
    expect(joined.get('simple-id')).toHaveLength(1);
  });

  // --- Mixed version fileset ---

  it('handles mixed multi-version fileset with correct counts', async () => {
    await writeJsonl(dir, 'perf-20260101-mixed.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 'valid-1' })),
      JSON.stringify({
        ...makeOperation(),
        schema_version: 999,
      }),
      JSON.stringify({ random: 'unversioned' }),
      'totally broken json',
    ]);
    // Truncated final line
    await fs.appendFile(
      join(dir, 'perf-20260101-mixed.jsonl'),
      '{"schema_version":1,"record_type":"operation"',
      'utf8',
    );

    const report = await buildReport(dir);

    expect(report.counts.parsed).toBe(1);
    expect(report.counts.futureVersion).toBe(1);
    expect(report.counts.unversioned).toBe(1);
    expect(report.counts.malformed).toBe(1);
    expect(report.counts.truncated).toBe(1);
    expect(report.selfHealth.skipped).toBe(3); // malformed + future + unversioned
    expect(report.selfHealth.truncated).toBe(1);
    expect(report.selfHealth.lastWriteErrorCode).toBeUndefined();
    expect(report.selfHealth.evictionCount).toBeUndefined();
  });

  // --- P11: baseline pools ALL matching baseline rows per dimension ---

  it('baseline pools all matching same-version/different-sha rows per dimension (not last-build overwrite)', async () => {
    // Two baseline builds sharing version "0.10.0" but different git_shas,
    // same dimensions. Pooled p50 must be computed over ALL baseline rows.
    //   group aaa: [100, 200] -> individual p50 = 100
    //   group bbb: [300, 400] -> individual p50 = 300
    //   pooled:    [100, 200, 300, 400] -> p50 = 200
    await writeJsonl(dir, 'perf-20260101-aaa.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          operation_id: 'a1',
          operation_elapsed_ms: 100,
        }),
      ),
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          operation_id: 'a2',
          operation_elapsed_ms: 200,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-bbb.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'bbb',
          operation_id: 'b1',
          operation_elapsed_ms: 300,
        }),
      ),
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'bbb',
          operation_id: 'b2',
          operation_elapsed_ms: 400,
        }),
      ),
    ]);
    // Non-baseline group compared against the pooled baseline.
    await writeJsonl(dir, 'perf-20260103-ccc.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'ccc',
          operation_elapsed_ms: 500,
        }),
      ),
    ]);

    const report = await buildReport(dir, '0.10.0');

    // Baseline build groups are preserved in output.
    const baseAaa = report.groups.find((g) => g.build.git_sha === 'aaa');
    const baseBbb = report.groups.find((g) => g.build.git_sha === 'bbb');
    expect(baseAaa).toBeDefined();
    expect(baseBbb).toBeDefined();
    expect(baseAaa!.isBaseline).toBe(true);
    expect(baseBbb!.isBaseline).toBe(true);

    const newGroup = report.groups.find((g) => g.build.git_sha === 'ccc');
    expect(newGroup).toBeDefined();
    expect(newGroup!.baselineComparison!.matched).toBe(true);
    const delta = newGroup!.baselineComparison!.deltas!['operation_elapsed_ms'];
    // Pooled baseline p50 = 200, so delta = 500 - 200 = 300.
    // The previous overwrite behavior compared against bbb's p50 (300),
    // yielding 200 — this assertion fails that behavior.
    expect(delta.absolute).toBe(300);
  });

  it('baseline by exact sha pools all matching rows across builds', async () => {
    // Same git_sha appears in two version groups (same dimensions). Both are
    // baseline; the pooled p50 is over all four rows.
    await writeJsonl(dir, 'perf-20260101-a.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'sha1',
          operation_elapsed_ms: 100,
        }),
      ),
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'sha1',
          operation_elapsed_ms: 200,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-b.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.1',
          git_sha: 'sha1',
          operation_elapsed_ms: 300,
        }),
      ),
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.1',
          git_sha: 'sha1',
          operation_elapsed_ms: 400,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260103-c.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'sha2',
          operation_elapsed_ms: 500,
        }),
      ),
    ]);

    const report = await buildReport(dir, 'sha1');
    const newGroup = report.groups.find((g) => g.build.git_sha === 'sha2');
    const delta = newGroup!.baselineComparison!.deltas!['operation_elapsed_ms'];
    // Pooled over [100,200,300,400] -> p50 200; delta = 500 - 200 = 300.
    expect(delta.absolute).toBe(300);
  });

  // --- P11: self-health skipped includes blank lines, excludes truncated ---

  it('self-health skipped includes blank lines (not double-counting truncated)', async () => {
    await writeJsonl(dir, 'perf-20260101-mixed.jsonl', [
      JSON.stringify(makeOperation({ operation_id: 'valid-1' })),
      '', // blank
      '  ', // blank (whitespace-only)
      'not valid json', // malformed
    ]);

    const report = await buildReport(dir);

    // skipped = malformed(1) + future(0) + unversioned(0) + blank(2) = 3
    expect(report.counts.blank).toBe(2);
    expect(report.counts.malformed).toBe(1);
    expect(report.counts.truncated).toBe(0);
    expect(report.selfHealth.skipped).toBe(3);
    expect(report.selfHealth.truncated).toBe(0);
  });

  // --- P11: formatter surfaces all four memory slopes for both axes ---

  it('formatter surfaces all four memory slopes for per-op and per-min', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: 'op-1',
          session_operation_index: 0,
          rss_bytes: 50_000_000,
          heap_used_bytes: 20_000_000,
          external_bytes: 5_000_000,
          array_buffers_bytes: 1_000_000,
        }),
      ),
      JSON.stringify(
        makeOperation({
          operation_id: 'op-2',
          session_operation_index: 1,
          rss_bytes: 60_000_000,
          heap_used_bytes: 25_000_000,
          external_bytes: 6_000_000,
          array_buffers_bytes: 2_000_000,
        }),
      ),
      JSON.stringify({
        schema_version: 1,
        record_type: 'memory_sample',
        ts: '2026-01-01T00:00:00.000Z',
        rss_bytes: 50_000_000,
        heap_used_bytes: 20_000_000,
        external_bytes: 5_000_000,
        array_buffers_bytes: 1_000_000,
        uptime_ms: 0,
        ms_since_last_operation: 0,
      }),
      JSON.stringify({
        schema_version: 1,
        record_type: 'memory_sample',
        ts: '2026-01-01T00:01:00.000Z',
        rss_bytes: 60_000_000,
        heap_used_bytes: 25_000_000,
        external_bytes: 6_000_000,
        array_buffers_bytes: 2_000_000,
        uptime_ms: 60_000,
        ms_since_last_operation: 30_000,
      }),
    ]);

    const report = await buildReport(dir);
    const text = formatReport(report);

    // per-op: all four slopes present
    expect(text).toContain('per-op:');
    expect(text).toContain('rss=');
    expect(text).toContain('heap=');
    expect(text).toContain('external=');
    expect(text).toContain('array_buffers=');
    // per-min: all four slopes present. Both per-op and per-min lines carry
    // external/array_buffers, so each appears at least twice in the slopes
    // section (once per axis).
    const externalCount = (text.match(/external=/g) ?? []).length;
    const arrayBuffersCount = (text.match(/array_buffers=/g) ?? []).length;
    expect(externalCount).toBeGreaterThanOrEqual(2);
    expect(arrayBuffersCount).toBeGreaterThanOrEqual(2);
    expect(text).toContain('per-min:');
  });

  // --- P11: pooled baseline p50 uses aggregated continuation token totals ---

  it('pooled baseline p50 uses the same aggregated continuation token totals as report groups (D1 join)', async () => {
    // Baseline perf record carries persisted context_tokens: 1000.
    // Token-usage rows for the baseline operation have an initial send (500)
    // and one continuation (700), aggregated to 1200.
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          operation_id: 'base-op',
          context_tokens: 1000,
          output_tokens: 200,
        }),
      ),
    ]);

    // Token usage directory with continuation rows.
    const tokenDir = await makeTempDir();
    try {
      await writeJsonl(tokenDir, 'tokens.jsonl', [
        JSON.stringify({
          prompt_id: 'base-op',
          actual_prompt_tokens: 500,
          output_tokens: 100,
        }),
        JSON.stringify({
          prompt_id: 'base-op#continuation#1',
          actual_prompt_tokens: 700,
          output_tokens: 150,
        }),
      ]);

      const report = await buildReport(dir, undefined, undefined, tokenDir);

      const baselineGroup = report.groups.find(
        (g) => g.build.git_sha === 'aaa',
      );
      expect(baselineGroup).toBeDefined();
      // The aggregated join total (500 + 700 = 1200) replaces the persisted
      // perf total (1000).
      expect(baselineGroup!.p50.context_tokens).toBe(1200);
      expect(baselineGroup!.p50.output_tokens).toBe(250);
    } finally {
      await fs.rm(tokenDir, { recursive: true, force: true });
    }
  });

  it('persisted baseline tokens differ from initial+continuation rows and delta proves joined value was used', async () => {
    // Baseline: persisted context_tokens: 1000 (but the real joined total is
    // 500 + 700 = 1200). Current: context_tokens: 1500.
    //
    // If the persisted baseline (1000) were used: delta = 1500 - 1000 = 500.
    // If the joined baseline (1200) is used:     delta = 1500 - 1200 = 300.
    // Asserting 300 proves the joined value was used.
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'aaa',
          operation_id: 'base-op',
          context_tokens: 1000,
          output_tokens: 200,
        }),
      ),
    ]);
    await writeJsonl(dir, 'perf-20260102-new.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.11.0',
          git_sha: 'bbb',
          operation_id: 'new-op',
          context_tokens: 1500,
          output_tokens: 300,
        }),
      ),
    ]);

    const tokenDir = await makeTempDir();
    try {
      await writeJsonl(tokenDir, 'tokens.jsonl', [
        JSON.stringify({
          prompt_id: 'base-op',
          actual_prompt_tokens: 500,
        }),
        JSON.stringify({
          prompt_id: 'base-op#continuation#1',
          actual_prompt_tokens: 700,
        }),
      ]);

      const report = await buildReport(dir, '0.10.0', undefined, tokenDir);

      // Baseline p50 must use the joined total (1200), not persisted (1000).
      const baselineGroup = report.groups.find(
        (g) => g.build.git_sha === 'aaa',
      );
      expect(baselineGroup!.p50.context_tokens).toBe(1200);

      const newGroup = report.groups.find((g) => g.build.git_sha === 'bbb');
      expect(newGroup!.baselineComparison!.matched).toBe(true);
      const delta = newGroup!.baselineComparison!.deltas!['context_tokens'];
      // delta = 1500 - 1200 = 300 (joined baseline), NOT 1500 - 1000 = 500.
      expect(delta.absolute).toBe(300);
    } finally {
      await fs.rm(tokenDir, { recursive: true, force: true });
    }
  });

  it('preserves lower-nearest-rank p50 for even sample counts', async () => {
    // With an even count of [100, 200], the lower nearest-rank p50 is 100
    // (sorted[0]), not the average (150).
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 100,
          operation_id: 'op-a',
        }),
      ),
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 200,
          operation_id: 'op-b',
        }),
      ),
    ]);

    const report = await buildReport(dir);
    expect(report.groups[0].p50.operation_elapsed_ms).toBe(100);

    // With four values [100, 200, 300, 400], lower nearest-rank is 200.
    await writeJsonl(dir, 'perf-20260102-run2.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 300,
          operation_id: 'op-c',
        }),
      ),
      JSON.stringify(
        makeOperation({
          operation_elapsed_ms: 400,
          operation_id: 'op-d',
        }),
      ),
    ]);

    const report2 = await buildReport(dir);
    expect(report2.groups[0].p50.operation_elapsed_ms).toBe(200);
  });
});
