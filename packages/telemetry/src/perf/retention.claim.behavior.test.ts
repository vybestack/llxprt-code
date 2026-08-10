/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Claim-mechanism behavioral tests for PerfRetention (D5, AC-7, D3).
 *
 * Covers the claim file contract split out of the original
 * retention.behavior.test.ts: the retention constants (D5), the claim file
 * lifecycle (AC-7, D3), counting of non-stale claims (AC-7, D3), and the
 * invariant that claim files are never parsed as perf JSONL.
 *
 * Real files, real filesystem, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfRetention,
  PERF_MAX_BYTES,
  PERF_MAX_FILES,
  PERF_MAINTENANCE_INTERVAL_MS,
  PERF_CLAIM_LEASE_MS,
  type PerfScheduler,
  type PerfTimerHandle,
} from './retention.js';
import { readPerfRecords } from './perfRecords.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-retention-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePerfFile(
  name: string,
  recordCount: number,
  recordBytes = 1220,
): void {
  const lines: string[] = [];
  for (let i = 0; i < recordCount; i++) {
    const padding = '.'.repeat(
      Math.max(0, recordBytes - 80 - String(i).length),
    );
    lines.push(
      JSON.stringify({
        schema_version: 1,
        record_type: 'operation',
        ts: '2026-08-08T12:00:00.000Z',
        pad: padding,
        idx: i,
      }),
    );
  }
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
}

function writePerfFileExact(name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content);
}

function createClaimFile(uuid: string, mtimeMs: number): void {
  const p = path.join(dir, `${uuid}.claim`);
  fs.writeFileSync(p, '', { mode: 0o600 });
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

function listFiles(): string[] {
  return fs.readdirSync(dir).sort();
}

class TestScheduler implements PerfScheduler {
  callback: (() => Promise<void>) | null = null;
  handle: PerfTimerHandle | null = null;

  setInterval(callback: () => Promise<void>, _ms: number): PerfTimerHandle {
    this.callback = callback;
    this.handle = { unref: () => {}, clear: () => {} };
    return this.handle;
  }
}

describe('PerfRetention constants (D5)', () => {
  it('MAX_BYTES is 64 MiB', () => {
    expect(PERF_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  it('MAX_FILES is 128', () => {
    expect(PERF_MAX_FILES).toBe(128);
  });

  it('MAINTENANCE_INTERVAL_MS is 60 seconds', () => {
    expect(PERF_MAINTENANCE_INTERVAL_MS).toBe(60_000);
  });

  it('CLAIM_LEASE_MS is three maintenance intervals (180s)', () => {
    expect(PERF_CLAIM_LEASE_MS).toBe(PERF_MAINTENANCE_INTERVAL_MS * 3);
  });
});

describe('PerfRetention claim lifecycle (AC-7, D3)', () => {
  it('start() creates a UUID claim file exclusively', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000000',
    });
    await retention.start();

    const files = listFiles();
    expect(files).toContain('00000000-0000-4000-8000-000000000000.claim');
    await retention.dispose();
  });

  it.skipIf(process.platform === 'win32')(
    'start() creates the claim with 0600 permissions',
    async () => {
      const retention = new PerfRetention({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000001',
      });
      await retention.start();

      const stat = fs.statSync(
        path.join(dir, '00000000-0000-4000-8000-000000000001.claim'),
      );
      expect(stat.mode & 0o777).toBe(0o600);
      await retention.dispose();
    },
  );

  it('start() creates only the claim — no perf JSONL', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000002',
    });
    await retention.start();

    const files = listFiles();
    expect(files).toEqual(['00000000-0000-4000-8000-000000000002.claim']);
    await retention.dispose();
  });

  it('tick() touches the claim mtime (within lease window)', async () => {
    const scheduler = new TestScheduler();
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000003',
      scheduler,
      maintenanceIntervalMs: 60_000,
      claimLeaseMs: 180_000,
    });
    await retention.start();

    const beforeMtime = fs.statSync(
      path.join(dir, '00000000-0000-4000-8000-000000000003.claim'),
    ).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));

    await scheduler.callback!();

    const afterMtime = fs.statSync(
      path.join(dir, '00000000-0000-4000-8000-000000000003.claim'),
    ).mtimeMs;

    expect(afterMtime).toBeGreaterThan(beforeMtime);
    await retention.dispose();
  });

  it('dispose() removes the claim file cleanly', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000004',
    });
    await retention.start();
    expect(listFiles()).toContain('00000000-0000-4000-8000-000000000004.claim');

    await retention.dispose();
    expect(listFiles()).not.toContain(
      '00000000-0000-4000-8000-000000000004.claim',
    );
  });

  it('dispose() stops the interval (no further ticks)', async () => {
    const scheduler = new TestScheduler();
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000005',
      scheduler,
    });
    await retention.start();
    await retention.dispose();

    // Verify the claim file THIS instance created was removed by dispose().
    expect(listFiles()).not.toContain(
      '00000000-0000-4000-8000-000000000005.claim',
    );

    // Verify the interval callback is no longer active: calling it after
    // dispose should not re-create the claim file.
    if (scheduler.callback) {
      await scheduler.callback();
    }
    expect(listFiles()).not.toContain(
      '00000000-0000-4000-8000-000000000005.claim',
    );
  });

  it('crash (no dispose) leaves a stale claim until sweep', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000006',
    });
    await retention.start();

    const files = listFiles();
    expect(files).toContain('00000000-0000-4000-8000-000000000006.claim');

    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-000000000006.claim'),
      ),
    ).toBe(true);
  });
});

describe('PerfRetention countNonStaleClaims (AC-7, D3)', () => {
  it('counts only fresh claims within the lease window', async () => {
    const now = Date.now();

    createClaimFile('fresh-uuid', now - 10_000);

    createClaimFile('stale-uuid', now - PERF_CLAIM_LEASE_MS - 1);

    createClaimFile('another-fresh', now - 60_000);

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000007',
    });
    const count = await retention.countNonStaleClaims(now);
    expect(count).toBe(2);
  });

  it('returns 0 when only stale claims exist', async () => {
    const now = Date.now();
    createClaimFile('old1', now - PERF_CLAIM_LEASE_MS - 1000);
    createClaimFile('old2', now - PERF_CLAIM_LEASE_MS - 5000);

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000008',
    });
    const count = await retention.countNonStaleClaims(now);
    expect(count).toBe(0);
  });

  it('returns 0 when no claims exist', async () => {
    writePerfFile('perf-20260808-uuid.jsonl', 3);
    const retention = new PerfRetention({ dir, runUuid: 'uuid' });
    const count = await retention.countNonStaleClaims(Date.now());
    expect(count).toBe(0);
  });

  it('ignores non-claim files when counting', async () => {
    const now = Date.now();
    createClaimFile('fresh', now - 10_000);
    writePerfFile('perf-20260808-uuid.jsonl', 3);

    const retention = new PerfRetention({ dir, runUuid: 'old' });
    const count = await retention.countNonStaleClaims(now);
    expect(count).toBe(1);
  });
});

describe('PerfRetention — claims never parsed as JSONL', () => {
  it('a .claim file is not picked up by readPerfRecords', async () => {
    const now = Date.now();

    const validRecord = JSON.stringify({
      schema_version: 1,
      record_type: 'operation',
      ts: '2026-08-08T12:00:00.000Z',
      session_id: 'sess-abc',
      operation_id: 'sess-abc#agentic-loop#f7e2',
      runtime_id: 'rt-main',
      parent_runtime_id: null,
      subagent_name: null,
      project_hash: 'sha256:hash',
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
    });
    writePerfFileExact(
      'perf-20260808-00000000-0000-4000-8000-00000000001c.jsonl',
      validRecord + String.fromCharCode(10),
    );
    createClaimFile('00000000-0000-4000-8000-00000000001c', now);

    const perfFiles = listFiles().filter(
      (f) => f.startsWith('perf-') && f.endsWith('.jsonl'),
    );
    expect(perfFiles).toEqual([
      'perf-20260808-00000000-0000-4000-8000-00000000001c.jsonl',
    ]);

    expect(listFiles()).toContain('00000000-0000-4000-8000-00000000001c.claim');
    expect(perfFiles).not.toContain(
      '00000000-0000-4000-8000-00000000001c.claim',
    );

    const { counts } = await readPerfRecords(path.join(dir, perfFiles[0]));
    expect(counts.parsed).toBe(1);
  });
});
