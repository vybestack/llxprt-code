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
  createPerfCommand,
  type PerfSnapshotCapability,
  type PerfOperations,
} from './perfCommand.js';
import type { MessageActionReturn } from './types.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';

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
    `perf-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe('PerfCommand (P11, AC-9)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // --- /perf inspect ---

  it('/perf inspect returns directory info and counts', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);

    const cmd = createPerfCommand({ perfDir: dir });
    const inspectSub = cmd.subCommands!.find((s) => s.name === 'inspect')!;
    const result = await inspectSub.action!({} as never, '');

    expect(isMessage(result)).toBe(true);
    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('info');
    expect(msg.content).toContain('Perf Inspect');
    expect(msg.content).toContain(dir);
    expect(msg.content).toContain('operations: 1');
  });

  it('/perf inspect on empty directory shows zero counts', async () => {
    const cmd = createPerfCommand({ perfDir: dir });
    const inspectSub = cmd.subCommands!.find((s) => s.name === 'inspect')!;
    const result = await inspectSub.action!({} as never, '');

    expect(isMessage(result)).toBe(true);
    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('Owned JSONL files: 0');
    expect(msg.content).toContain('operations: 0');
  });

  // --- /perf report ---

  it('/perf report returns longitudinal report', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation({ operation_elapsed_ms: 1000 })),
    ]);

    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    expect(isMessage(result)).toBe(true);
    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('Perf Report');
    expect(msg.content).toContain('operation_elapsed_ms');
    expect(msg.content).toContain('p50=1000');
  });

  it('/perf report without baseline has no delta text', async () => {
    await writeJsonl(dir, 'perf-20260101-run1.jsonl', [
      JSON.stringify(makeOperation()),
    ]);

    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.content).not.toContain('Baseline:');
  });

  it('/perf report --baseline VERSION parses and shows deltas', async () => {
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
          operation_elapsed_ms: 2000,
        }),
      ),
    ]);

    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '--baseline 0.10.0');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('info');
    expect(msg.content).toContain('Baseline: 0.10.0 (matched)');
    expect(msg.content).toContain('delta');
  });

  it('/perf report --baseline SHA parses correctly', async () => {
    await writeJsonl(dir, 'perf-20260101-base.jsonl', [
      JSON.stringify(
        makeOperation({
          llxprt_version: '0.10.0',
          git_sha: 'abc1234',
          operation_elapsed_ms: 1000,
        }),
      ),
    ]);

    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '--baseline abc1234');

    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('Baseline: abc1234 (matched)');
  });

  it('/perf report --baseline (no value) rejects with useful error', async () => {
    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '--baseline');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain('--baseline requires a value');
  });

  it('/perf report --baseline --other rejects malformed', async () => {
    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '--baseline --other');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain('--baseline requires a value');
  });

  it('/perf report with unexpected argument rejects', async () => {
    const cmd = createPerfCommand({ perfDir: dir });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, 'unexpected-arg');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain("unexpected argument 'unexpected-arg'");
  });

  // --- /perf delete ---

  it('/perf delete removes stale perf files', async () => {
    // Old file (eligible for deletion)
    await writeJsonl(dir, 'perf-20250101-old.jsonl', [
      JSON.stringify(makeOperation()),
    ]);
    // Stale claim (set mtime well in the past, past the 180s lease)
    await fs.writeFile(join(dir, 'stale.claim'), '');
    const staleTime = new Date(Date.now() - 300_000); // 5 min ago
    await fs.utimes(join(dir, 'stale.claim'), staleTime, staleTime);

    const cmd = createPerfCommand({ perfDir: dir });
    const deleteSub = cmd.subCommands!.find((s) => s.name === 'delete')!;
    const result = await deleteSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('info');
    expect(msg.content).toContain('Perf Delete');
    expect(msg.content).toContain('Deleted: 2 file(s)');

    // Verify files are gone
    const remaining = await fs.readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('/perf delete does not delete active writer files', async () => {
    const dayKey = (() => {
      const d = new Date();
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    })();

    // Today's file with recent mtime (active writer)
    await writeJsonl(dir, `perf-${dayKey}-active.jsonl`, [
      JSON.stringify(makeOperation()),
    ]);

    const cmd = createPerfCommand({ perfDir: dir });
    const deleteSub = cmd.subCommands!.find((s) => s.name === 'delete')!;
    const result = await deleteSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('Protected (live):');

    // File still exists
    const remaining = await fs.readdir(dir);
    expect(remaining).toContain(`perf-${dayKey}-active.jsonl`);
  });

  // --- /perf (no args) ---

  it('/perf with no snapshot capability says unavailable honestly', async () => {
    const cmd = createPerfCommand({ perfDir: dir });
    const result = await cmd.action!({} as never, '');

    expect(isMessage(result)).toBe(true);
    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('info');
    expect(msg.content).toContain('not active');
  });

  it('/perf with snapshot capability shows current process snapshot', async () => {
    const capability: PerfSnapshotCapability = {
      getMemorySnapshot: () => [
        {
          rss: 50_000_000,
          heapUsed: 20_000_000,
          external: 5_000_000,
          arrayBuffers: 1_000_000,
          uptimeMs: 60_000,
          msSinceLastOperation: 5_000,
          timestampMs: Date.now(),
        },
      ],
      getActiveOperationSummary: () => ({
        provider: 'test-provider',
        model: 'test-model',
        elapsedMs: 12_000,
      }),
      getSelfHealth: () => ({ lastWriteErrorCode: null, evictionCount: 0 }),
    };

    const cmd = createPerfCommand({
      perfDir: dir,
      snapshotCapability: capability,
    });
    const result = await cmd.action!({} as never, '');

    expect(isMessage(result)).toBe(true);
    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('info');
    expect(msg.content).toContain('Perf Snapshot');
    expect(msg.content).toContain('Active operation');
    expect(msg.content).toContain('Memory samples: 1');
  });

  it('/perf trend scales a large negative RSS delta by magnitude (not raw bytes)', async () => {
    // Two samples with a large negative RSS delta (~-10 MiB). The old
    // formatBytes treated negatives as < 1024 (raw B); the fix scales the
    // absolute value while preserving the sign.
    const firstRss = 50_000_000;
    const secondRss = 39_510_016; // delta ≈ -10_489_984 bytes ≈ -10.0 MiB
    const firstUptime = 10_000;
    const secondUptime = 70_000;
    const capability: PerfSnapshotCapability = {
      getMemorySnapshot: () => [
        {
          rss: firstRss,
          heapUsed: 20_000_000,
          external: 5_000_000,
          arrayBuffers: 1_000_000,
          uptimeMs: firstUptime,
          msSinceLastOperation: 5_000,
          timestampMs: Date.now(),
        },
        {
          rss: secondRss,
          heapUsed: 18_000_000,
          external: 4_000_000,
          arrayBuffers: 900_000,
          uptimeMs: secondUptime,
          msSinceLastOperation: 2_000,
          timestampMs: Date.now(),
        },
      ],
      getActiveOperationSummary: () => null,
      getSelfHealth: () => ({ lastWriteErrorCode: null, evictionCount: 0 }),
    };

    const cmd = createPerfCommand({
      perfDir: dir,
      snapshotCapability: capability,
    });
    const result = await cmd.action!({} as never, '');
    const msg = result as MessageActionReturn;

    // The trend line must contain the scaled unit (MiB) with a leading minus,
    // not the raw byte count.
    expect(msg.content).toContain('trend:');
    expect(msg.content).toContain('-10.0 MiB');
    expect(msg.content).not.toContain('-10489984 B');
  });
  it('/perf with null snapshot capability says unavailable', async () => {
    const cmd = createPerfCommand({ perfDir: dir, snapshotCapability: null });
    const result = await cmd.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.content).toContain('not active');
  });

  it('/perf with unknown subcommand returns error', async () => {
    const cmd = createPerfCommand({ perfDir: dir });
    const result = await cmd.action!({} as never, 'unknownsub');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain('Unknown subcommand');
  });

  // --- P11: errno I/O failures → user error; non-errno → reject ---

  function errnoOperations(
    method: 'inspect' | 'report' | 'delete',
    err: Error & { code?: string },
  ): PerfOperations {
    const thrower = async (): Promise<never> => {
      throw err;
    };
    const noop = async (): Promise<never> => {
      throw new Error('should not be called');
    };
    return {
      inspect: method === 'inspect' ? thrower : (noop as never),
      report: method === 'report' ? thrower : (noop as never),
      delete: method === 'delete' ? thrower : (noop as never),
    };
  }

  it('/perf inspect converts an errno I/O failure to a user error message', async () => {
    const err = new Error('permission denied') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    const cmd = createPerfCommand({
      perfDir: dir,
      operations: errnoOperations('inspect', err),
    });
    const inspectSub = cmd.subCommands!.find((s) => s.name === 'inspect')!;
    const result = await inspectSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain('Failed to inspect perf data');
    expect(msg.content).toContain('permission denied');
  });

  it('/perf report converts an errno I/O failure to a user error message', async () => {
    const err = new Error('read-only') as NodeJS.ErrnoException;
    err.code = 'EROFS';
    const cmd = createPerfCommand({
      perfDir: dir,
      operations: errnoOperations('report', err),
    });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    const result = await reportSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain('Failed to generate perf report');
  });

  it('/perf delete converts an errno I/O failure to a user error message', async () => {
    const err = new Error('no space') as NodeJS.ErrnoException;
    err.code = 'ENOSPC';
    const cmd = createPerfCommand({
      perfDir: dir,
      operations: errnoOperations('delete', err),
    });
    const deleteSub = cmd.subCommands!.find((s) => s.name === 'delete')!;
    const result = await deleteSub.action!({} as never, '');

    const msg = result as MessageActionReturn;
    expect(msg.messageType).toBe('error');
    expect(msg.content).toContain('Failed to delete perf data');
  });

  it('/perf inspect allows a non-errno internal error to reject', async () => {
    const cmd = createPerfCommand({
      perfDir: dir,
      operations: errnoOperations('inspect', new TypeError('internal bug')),
    });
    const inspectSub = cmd.subCommands!.find((s) => s.name === 'inspect')!;
    await expect(inspectSub.action!({} as never, '')).rejects.toThrow(
      TypeError,
    );
  });

  it('/perf report allows a non-errno internal error to reject', async () => {
    const cmd = createPerfCommand({
      perfDir: dir,
      operations: errnoOperations('report', new RangeError('internal bug')),
    });
    const reportSub = cmd.subCommands!.find((s) => s.name === 'report')!;
    await expect(reportSub.action!({} as never, '')).rejects.toThrow(
      RangeError,
    );
  });

  it('/perf delete allows a non-errno internal error to reject', async () => {
    const cmd = createPerfCommand({
      perfDir: dir,
      operations: errnoOperations('delete', new TypeError('internal bug')),
    });
    const deleteSub = cmd.subCommands!.find((s) => s.name === 'delete')!;
    await expect(deleteSub.action!({} as never, '')).rejects.toThrow(TypeError);
  });

  // --- Loader registration ---

  it('perf command is registered in BuiltinCommandLoader', () => {
    const loader = new BuiltinCommandLoader(null);
    const commands = loader.loadCommandsSync();
    const perf = commands.find((c) => c.name === 'perf');

    expect(perf).toBeDefined();
    expect(perf!.kind).toBe('built-in' as never);
    expect(perf!.description).toContain('Performance telemetry');
    expect(perf!.subCommands).toBeDefined();
    expect(perf!.subCommands!.map((s) => s.name)).toContain('inspect');
    expect(perf!.subCommands!.map((s) => s.name)).toContain('report');
    expect(perf!.subCommands!.map((s) => s.name)).toContain('delete');
  });

  // --- P12: /perf factory wiring with owned snapshot capability ---

  it('BuiltinCommandLoader uses injected snapshot capability when available', async () => {
    const capability: PerfSnapshotCapability = {
      getMemorySnapshot: () => [],
      getActiveOperationSummary: () => ({
        provider: 'openai',
        model: 'gpt-4o',
        elapsedMs: 1234,
      }),
      getSelfHealth: () => ({ lastWriteErrorCode: null, evictionCount: 0 }),
    };
    // Minimal config: truthy so ideCommand/restoreCommand are evaluated, but
    // they short-circuit to null when their accessors return undefined/false.
    const loader = new BuiltinCommandLoader({
      getPerfSnapshotCapability: () => capability,
      getProjectTempDir: () => join(tmpdir(), 'token-usage'),
      getIdeClient: () => undefined,
      getCheckpointingEnabled: () => false,
      getEnableHooksUI: () => false,
      isSkillsSupportEnabled: () => false,
    } as never);
    const commands = loader.loadCommandsSync();
    const perf = commands.find((c) => c.name === 'perf')!;
    const result = (await perf.action!({} as never, '')) as MessageActionReturn;
    expect(result.type).toBe('message');
    expect(result.content).toContain('Active operation');
    expect(result.content).toContain('openai');
    expect(result.content).toContain('gpt-4o');
  });

  it('BuiltinCommandLoader without snapshot capability says not active', async () => {
    const loader = new BuiltinCommandLoader(null);
    const commands = loader.loadCommandsSync();
    const perf = commands.find((c) => c.name === 'perf')!;
    const result = (await perf.action!({} as never, '')) as MessageActionReturn;
    expect(result.type).toBe('message');
    expect(result.content).toContain('not active');
  });
});
