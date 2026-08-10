/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding C behavioral tests — production /perf report wiring.
 *
 * Proves: (1) the default production operation invocation receives the exact
 * perf dir, baseline, self-health, and token-usage directory; (2) inactive
 * health formats unavailable rather than falsely claiming null/0; (3) active
 * clean health is known null/0; (4) active errors/evictions propagate; (5)
 * continuation token rows in a real project token-usage directory affect the
 * production command report (not helper-only).
 *
 * Uses REAL files and the REAL production buildReport (default operations) for
 * formatting + token-join evidence, plus a capturing operations port for wiring
 * verification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPerfCommand,
  type PerfSnapshotCapability,
  type PerfOperations,
  type PerfSelfHealth,
} from './perfCommand.js';
import type { MessageActionReturn } from './types.js';
import type {
  ReportResult,
  ReportSelfHealth,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';

function makeOperation(
  overrides: Partial<PerfOperationRecord> = {},
): PerfOperationRecord {
  return {
    schema_version: 1,
    record_type: 'operation',
    ts: '2026-01-01T00:00:00.000Z',
    session_id: 'sess-1',
    operation_id: 'sess-1#agentic-loop#aaaa',
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

function isMessage(result: unknown): result is MessageActionReturn {
  return (
    typeof result === 'object' &&
    result !== null &&
    'type' in result &&
    (result as { type: string }).type === 'message'
  );
}

function emptyReportResult(): ReportResult {
  return {
    groups: [],
    counts: {
      files: 0,
      bytes: 0,
      parsed: 0,
      malformed: 0,
      futureVersion: 0,
      unversioned: 0,
      truncated: 0,
      blank: 0,
    },
    selfHealth: {
      skipped: 0,
      truncated: 0,
      lastWriteErrorCode: undefined,
      evictionCount: undefined,
    },
    baseline: null,
  };
}

describe('Finding C — production /perf report wiring', () => {
  let perfDir: string;
  let tokenDir: string;

  beforeEach(async () => {
    perfDir = await makeTempDir('perf-wire');
    tokenDir = await makeTempDir('token-wire');
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(perfDir, { recursive: true, force: true }),
      fs.rm(tokenDir, { recursive: true, force: true }),
    ]);
  });

  // --- (1) Default operation invocation receives exact params ---

  it('report subcommand passes exact perf dir, baseline, self-health, and token directory', async () => {
    let captured: {
      dir: string;
      baseline: string | undefined;
      selfHealth: Partial<ReportSelfHealth> | undefined;
      tokenUsageDir: string | undefined;
    } | null = null;

    const capturingOps: PerfOperations = {
      inspect: async () => {
        throw new Error('not used');
      },
      report: async (
        dir: string,
        baseline?: string,
        selfHealth?: Partial<ReportSelfHealth>,
        tokenUsageDir?: string,
      ): Promise<ReportResult> => {
        captured = { dir, baseline, selfHealth, tokenUsageDir };
        return emptyReportResult();
      },
      delete: async () => {
        throw new Error('not used');
      },
    };

    const capability: PerfSnapshotCapability = {
      getMemorySnapshot: () => null,
      getActiveOperationSummary: () => null,
      getSelfHealth: (): PerfSelfHealth => ({
        lastWriteErrorCode: null,
        evictionCount: 0,
      }),
    };

    const cmd = createPerfCommand({
      perfDir,
      operations: capturingOps,
      snapshotCapability: capability,
      tokenUsageDir: tokenDir,
    });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    await reportSub.action!({} as never, '--baseline 0.10.0');

    expect(captured).not.toBe(null);
    const c = captured!;
    expect(c.dir).toBe(perfDir);
    expect(c.baseline).toBe('0.10.0');
    expect(c.selfHealth).toEqual({
      lastWriteErrorCode: null,
      evictionCount: 0,
    });
    expect(c.tokenUsageDir).toBe(tokenDir);
  });

  // --- (2) Inactive health formats unavailable (not null/0) ---

  it('inactive report (no snapshot capability) formats self-health as unavailable', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);

    // No snapshotCapability: self-health is undefined → "unavailable".
    const cmd = createPerfCommand({ perfDir, tokenUsageDir: tokenDir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    expect(isMessage(result)).toBe(true);
    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('Self-health:');
    // Undefined lastWriteErrorCode → "unavailable", NOT "none".
    expect(msg.content).toContain('last write error: unavailable');
    // Undefined evictionCount → "unavailable", NOT "0".
    expect(msg.content).toContain('evictions: unavailable');
  });

  // --- (3) Active clean health is known null/0 ---

  it('active clean health formats as known null/0 (none and 0)', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);

    const capability: PerfSnapshotCapability = {
      getMemorySnapshot: () => null,
      getActiveOperationSummary: () => null,
      getSelfHealth: () => ({ lastWriteErrorCode: null, evictionCount: 0 }),
    };

    const cmd = createPerfCommand({
      perfDir,
      snapshotCapability: capability,
      tokenUsageDir: tokenDir,
    });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('last write error: none');
    expect(msg.content).toContain('evictions: 0');
  });

  // --- (4) Active errors/evictions propagate ---

  it('active errors/evictions propagate to the report self-health', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);

    const capability: PerfSnapshotCapability = {
      getMemorySnapshot: () => null,
      getActiveOperationSummary: () => null,
      getSelfHealth: () => ({
        lastWriteErrorCode: 'ENOSPC',
        evictionCount: 7,
      }),
    };

    const cmd = createPerfCommand({
      perfDir,
      snapshotCapability: capability,
      tokenUsageDir: tokenDir,
    });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('last write error: ENOSPC');
    expect(msg.content).toContain('evictions: 7');
  });

  // --- (5) Continuation token rows affect the production command report ---

  it('continuation token rows in a real token-usage directory affect the production report', async () => {
    const opId = 'sess-1#agentic-loop#aaaa';
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({
          operation_id: opId,
          context_tokens: 1000,
          output_tokens: 500,
        }),
      ),
    ]);

    // Token usage: initial + 2 continuations.
    await writeJsonl(tokenDir, 'usage.jsonl', [
      JSON.stringify({
        prompt_id: opId,
        actual_prompt_tokens: 1000,
        output_tokens: 100,
      }),
      JSON.stringify({
        prompt_id: `${opId}#continuation#1`,
        actual_prompt_tokens: 2000,
        output_tokens: 200,
      }),
      JSON.stringify({
        prompt_id: `${opId}#continuation#2`,
        actual_prompt_tokens: 3000,
        output_tokens: 300,
      }),
    ]);

    // Use the DEFAULT production operations (real buildReport) with a real
    // token-usage directory. This is NOT a helper-only test.
    const cmd = createPerfCommand({ perfDir, tokenUsageDir: tokenDir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    // Joined: 1000 + 2000 + 3000 = 6000 (replaces persisted 1000).
    expect(msg.content).toContain('context_tokens: p50=6000');
    // Joined output: 100 + 200 + 300 = 600 (replaces persisted 500).
    expect(msg.content).toContain('output_tokens: p50=600');
  });

  // --- (6) Token-usage directory omitted keeps persisted totals ---

  it('report without tokenUsageDir keeps persisted perf token totals', async () => {
    await writeJsonl(perfDir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(
        makeOperation({ context_tokens: 1234, output_tokens: 567 }),
      ),
    ]);

    const cmd = createPerfCommand({ perfDir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('context_tokens: p50=1234');
    expect(msg.content).toContain('output_tokens: p50=567');
  });

  // --- (7) Self-health is null when capability is null (not passed at all) ---

  it('report without snapshotCapability passes undefined self-health to operations', async () => {
    let reportWasCalled = false;
    let capturedSelfHealth: Partial<ReportSelfHealth> | null = null;

    const capturingOps: PerfOperations = {
      inspect: async () => {
        throw new Error('not used');
      },
      report: async (
        _dir: string,
        _baseline?: string,
        selfHealth?: Partial<ReportSelfHealth>,
      ): Promise<ReportResult> => {
        reportWasCalled = true;
        capturedSelfHealth = selfHealth ?? null;
        return emptyReportResult();
      },
      delete: async () => {
        throw new Error('not used');
      },
    };

    const cmd = createPerfCommand({ perfDir, operations: capturingOps });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    await reportSub.action!({} as never, '');

    // No capability → self-health is undefined (unavailable).
    expect(reportWasCalled).toBe(true);
    expect(capturedSelfHealth).toBe(null);
  });
});
