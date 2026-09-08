/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-directory behavioral evidence for the production read-time continuation
 * join (D1, AC-3).
 *
 * One initial send plus multiple continuations carry distinct `prompt_id`
 * values in the telemetry-owned token-usage JSONL. The report derives each
 * row's operation id at read time and joins ALL continuation rows onto the
 * SINGLE matched perf operation, replacing the persisted perf token totals
 * with the SUMMED joined actual_prompt_tokens / output_tokens. Unmatched
 * operations retain their persisted perf token totals. Malformed / lifecycle
 * rows in the token-usage directory are tolerated (counted, never fatal).
 *
 * No mocks — real files in two real directories (perf + token-usage).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReport, assembleReport } from './perfReport.js';
import { aggregateTokenUsageByOperation } from './perfReport.js';
import { consumeTokenUsageDirectory } from './tokenUsageReader.js';
import type { PerfOperationRecord } from './perfRecords.js';

const INITIAL_PROMPT_ID = 'sess-1#agentic-loop#aaaa';

function makeOperation(
  overrides: Partial<PerfOperationRecord> = {},
): PerfOperationRecord {
  return {
    schema_version: 1,
    record_type: 'operation',
    ts: '2026-01-01T00:00:00.000Z',
    session_id: 'sess-1',
    operation_id: INITIAL_PROMPT_ID,
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

async function makeTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function removeReportDirectories(
  perfDir: string | undefined,
  tokenDir: string,
): Promise<void> {
  if (perfDir !== undefined) {
    await fs.rm(perfDir, { recursive: true, force: true });
  }
  await fs.rm(tokenDir, { recursive: true, force: true });
}

function tokenLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    prompt_id: INITIAL_PROMPT_ID,
    actual_prompt_tokens: 1000,
    output_tokens: 100,
    ...overrides,
  });
}

describe('buildReport — read-time continuation join (D1, AC-3)', () => {
  let perfDir: string;
  let tokenDir: string;

  beforeEach(async () => {
    perfDir = await makeTempDir('perf-join');
    tokenDir = await makeTempDir('token-join');
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(perfDir, { recursive: true, force: true }),
      fs.rm(tokenDir, { recursive: true, force: true }),
    ]);
  });

  it('one initial + multiple continuations join to exactly one operation with summed tokens', async () => {
    // Perf: a single operation whose operation_id is the initial prompt id.
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: INITIAL_PROMPT_ID,
          context_tokens: 1000,
          output_tokens: 500,
        }),
      ),
    ]);

    // Token usage: initial + 2 continuations.
    await writeJsonl(tokenDir, 'usage.jsonl', [
      tokenLine({
        prompt_id: INITIAL_PROMPT_ID,
        actual_prompt_tokens: 1000,
        output_tokens: 100,
      }),
      tokenLine({
        prompt_id: `${INITIAL_PROMPT_ID}#continuation#1`,
        actual_prompt_tokens: 2000,
        output_tokens: 200,
      }),
      tokenLine({
        prompt_id: `${INITIAL_PROMPT_ID}#continuation#2`,
        actual_prompt_tokens: 3000,
        output_tokens: 300,
      }),
    ]);

    const report = await buildReport(perfDir, undefined, undefined, tokenDir);

    // Exactly one operation group with one sample.
    const ops = report.groups.flatMap((g) => g.sampleCount);
    expect(ops).toStrictEqual([1]);

    const group = report.groups[0];
    // Joined actual_prompt_tokens = 1000 + 2000 + 3000 = 6000 (replaces
    // persisted context_tokens 1000).
    expect(group.p50['context_tokens']).toBe(6000);
    // Joined output_tokens = 100 + 200 + 300 = 600 (replaces persisted 500).
    expect(group.p50['output_tokens']).toBe(600);
    // Non-token metrics are untouched.
    expect(group.p50['operation_elapsed_ms']).toBe(1000);
  });

  it('unmatched operations retain their persisted perf token totals', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: 'op-unmatched',
          context_tokens: 9999,
          output_tokens: 8888,
        }),
      ),
    ]);

    // Token usage references a DIFFERENT operation id — no match.
    await writeJsonl(tokenDir, 'usage.jsonl', [
      tokenLine({
        prompt_id: 'sess-other#agentic-loop#zzzz',
        actual_prompt_tokens: 1111,
        output_tokens: 2222,
      }),
    ]);

    const report = await buildReport(perfDir, undefined, undefined, tokenDir);

    const group = report.groups[0];
    // Persisted totals retained (no join match).
    expect(group.p50['context_tokens']).toBe(9999);
    expect(group.p50['output_tokens']).toBe(8888);
  });

  it('tolerates malformed and lifecycle rows in the token-usage directory without failing', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: INITIAL_PROMPT_ID,
          context_tokens: 0,
          output_tokens: 0,
        }),
      ),
    ]);

    await writeJsonl(tokenDir, 'usage.jsonl', [
      tokenLine({
        prompt_id: INITIAL_PROMPT_ID,
        actual_prompt_tokens: 400,
        output_tokens: 40,
      }),
      tokenLine({
        prompt_id: `${INITIAL_PROMPT_ID}#continuation#1`,
        actual_prompt_tokens: 600,
        output_tokens: 60,
      }),
      JSON.stringify({ record_type: 'compression', before: 10, after: 5 }),
      `this is not json`,
      ``,
      tokenLine({
        prompt_id: `${INITIAL_PROMPT_ID}#continuation#2`,
        actual_prompt_tokens: 1000,
        output_tokens: 100,
      }),
    ]);

    const report = await buildReport(perfDir, undefined, undefined, tokenDir);

    const group = report.groups[0];
    // 400 + 600 + 1000 = 2000, 40 + 60 + 100 = 200 — lifecycle/malformed/blank
    // rows ignored, not fatal.
    expect(group.p50['context_tokens']).toBe(2000);
    expect(group.p50['output_tokens']).toBe(200);
  });

  it('does not mutate the input token rows', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation({ operation_id: INITIAL_PROMPT_ID })),
    ]);
    await writeJsonl(tokenDir, 'usage.jsonl', [
      tokenLine({ prompt_id: INITIAL_PROMPT_ID, actual_prompt_tokens: 1000 }),
      tokenLine({
        prompt_id: `${INITIAL_PROMPT_ID}#continuation#1`,
        actual_prompt_tokens: 2000,
      }),
    ]);

    // Read the rows, snapshot the prompt ids, build the report, re-read.
    const before = await consumeTokenUsageDirectory(tokenDir);
    const beforeIds = before.rows.map((r) => r.promptId);

    await buildReport(perfDir, undefined, undefined, tokenDir);

    const after = await consumeTokenUsageDirectory(tokenDir);
    expect(after.rows.map((r) => r.promptId)).toStrictEqual(beforeIds);
    expect(after.counts.turns).toBe(2);
  });

  it('omitting tokenUsageDir keeps persisted perf token totals (backward compatible)', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: INITIAL_PROMPT_ID,
          context_tokens: 1234,
          output_tokens: 567,
        }),
      ),
    ]);

    const report = await buildReport(perfDir);
    const group = report.groups[0];
    expect(group.p50['context_tokens']).toBe(1234);
    expect(group.p50['output_tokens']).toBe(567);
  });
});

describe('assembleReport — direct join composition (D1)', () => {
  it('groups provided token rows by deriveOperationId and matches to perf operation_id', async () => {
    const tokenDir = await makeTempDir('token-asm');
    try {
      await writeJsonl(tokenDir, 'usage.jsonl', [
        tokenLine({
          prompt_id: 'op-A',
          actual_prompt_tokens: 10,
          output_tokens: 1,
        }),
        tokenLine({
          prompt_id: 'op-A#continuation#1',
          actual_prompt_tokens: 20,
          output_tokens: 2,
        }),
        tokenLine({
          prompt_id: 'op-A#continuation#2',
          actual_prompt_tokens: 30,
          output_tokens: undefined,
        }),
      ]);

      const { rows } = await consumeTokenUsageDirectory(tokenDir);
      const op = makeOperation({
        operation_id: 'op-A',
        context_tokens: 999,
        output_tokens: 999,
      });

      const report = assembleReport(
        [
          {
            op,
            sourceFile: 'perf-20260101-x.jsonl',
            runUuid: 'run-x',
          },
        ],
        new Map(),
        {
          files: 1,
          bytes: 0,
          parsed: 1,
          malformed: 0,
          futureVersion: 0,
          unversioned: 0,
          truncated: 0,
          blank: 0,
        },
        undefined,
        undefined,
        aggregateTokenUsageByOperation(rows),
      );

      // 10 + 20 + 30 = 60; output on first two only (third omitted) → 1 + 2 = 3.
      expect(report.groups[0].p50['context_tokens']).toBe(60);
      expect(report.groups[0].p50['output_tokens']).toBe(3);
    } finally {
      await fs.rm(tokenDir, { recursive: true, force: true });
    }
  });

  it('an empty token-usage directory yields no join (persisted totals retained)', async () => {
    const tokenDir = await makeTempDir('token-empty');
    let perfDir: string | undefined;
    try {
      const op = makeOperation({
        operation_id: 'op-B',
        context_tokens: 42,
        output_tokens: 7,
      });
      perfDir = await writePerfOp(op);
      const report = await buildReport(perfDir, undefined, undefined, tokenDir);
      expect(report.groups[0].p50['context_tokens']).toBe(42);
      expect(report.groups[0].p50['output_tokens']).toBe(7);
    } finally {
      await removeReportDirectories(perfDir, tokenDir);
    }
  });

  async function writePerfOp(op: PerfOperationRecord): Promise<string> {
    const p = await makeTempDir('perf-asm');
    await writeJsonl(p, 'perf-20260101-x.jsonl', [JSON.stringify(op)]);
    return p;
  }
});
