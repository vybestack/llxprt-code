/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-file behavioral tests for PerfSink + PerfRetention integration (P08).
 *
 * Verifies that maintenance is wired narrowly:
 *  - Roll boundary triggers maybeMaintain.
 *  - Disposal drains writes, stops maintenance, and removes the claim.
 *  - Empty started sink creates ONLY its claim (no perf JSONL).
 *  - Concurrent appends produce documented overshoot, then next sweep converges.
 *
 * No mocks. Real files, real filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PerfSink } from './PerfSink.js';
import { PerfRetention } from './retention.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-sink-retention-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function operationRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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
}

// ---------------------------------------------------------------------------
// start() creates only the claim — no perf JSONL
// ---------------------------------------------------------------------------

describe('PerfSink + retention — start creates only claim (AC-7)', () => {
  it('an empty started sink creates only its claim, no perf JSONL', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000000',
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000000',
      retention,
    });
    await sink.start();

    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(['00000000-0000-4000-8000-000000000000.claim']);
    await sink.dispose();
  });

  it('start then write creates the claim AND the perf JSONL', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000001',
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000001',
      retention,
    });
    await sink.start();
    await sink.write(operationRecord());

    const files = fs.readdirSync(dir).sort();
    expect(files).toContain('00000000-0000-4000-8000-000000000001.claim');
    expect(files).toContain(
      'perf-20260808-00000000-0000-4000-8000-000000000001.jsonl',
    );
    await sink.dispose();
  });
});

// ---------------------------------------------------------------------------
// Roll boundary triggers maintenance
// ---------------------------------------------------------------------------

describe('PerfSink + retention — roll boundary triggers maintenance (AC-7)', () => {
  it('a midnight roll triggers maybeMaintain which evicts old files', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000002',
      maxFiles: 2,
      maxBytes: 10_000_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000002',
      retention,
    });
    await sink.start();

    // Create old files BEFORE the first perf write. The first write's roll
    // triggers maybeMaintain (lastMaintenanceMs starts at 0, so the default
    // interval always admits the first call), which evicts them. These belong
    // to a DIFFERENT prior run (not the owner) so they are eligible.
    fs.writeFileSync(
      path.join(
        dir,
        'perf-20260101-00000000-0000-4000-8000-000000000092.jsonl',
      ),
      'data\n',
    );
    fs.writeFileSync(
      path.join(
        dir,
        'perf-20260102-00000000-0000-4000-8000-000000000092.jsonl',
      ),
      'data\n',
    );
    fs.writeFileSync(
      path.join(
        dir,
        'perf-20260103-00000000-0000-4000-8000-000000000092.jsonl',
      ),
      'data\n',
    );

    // Write a record — the roll boundary triggers maintenance.
    await sink.write(operationRecord({ ts: '2026-08-08T12:00:00.000Z' }));
    await sink.dispose();

    const files = fs.readdirSync(dir).sort();
    // Old files should have been evicted (maxFiles: 2, first maybeMaintain
    // always runs because lastMaintenanceMs initializes to 0).
    expect(files).not.toContain(
      'perf-20260101-00000000-0000-4000-8000-000000000092.jsonl',
    );
    expect(files).not.toContain(
      'perf-20260102-00000000-0000-4000-8000-000000000092.jsonl',
    );
    expect(files).not.toContain(
      'perf-20260103-00000000-0000-4000-8000-000000000092.jsonl',
    );
  });
});

// ---------------------------------------------------------------------------
// Disposal drains writes, stops maintenance, removes claim
// ---------------------------------------------------------------------------

describe('PerfSink + retention — disposal (AC-7)', () => {
  it('dispose drains writes, then stops maintenance and removes claim', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000003',
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000003',
      retention,
    });
    await sink.start();

    // Queue a write.
    await sink.write(operationRecord());

    // Dispose should drain + remove claim.
    await sink.dispose();

    const files = fs.readdirSync(dir).sort();
    // Claim should be gone; perf file should remain.
    expect(files).not.toContain('00000000-0000-4000-8000-000000000003.claim');
    expect(files).toContain(
      'perf-20260808-00000000-0000-4000-8000-000000000003.jsonl',
    );
  });

  it('dispose after start with no writes leaves no files', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000004',
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000004',
      retention,
    });
    await sink.start();
    await sink.dispose();

    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: PerfSink without retention works as before
// ---------------------------------------------------------------------------

describe('PerfSink without retention — backward compatible', () => {
  it('write + dispose work without retention (no start needed)', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000005',
    });
    await sink.write(operationRecord());
    await sink.dispose();

    const files = fs.readdirSync(dir);
    expect(files).toEqual([
      'perf-20260808-00000000-0000-4000-8000-000000000005.jsonl',
    ]);
    // No claim file.
    expect(files).not.toContain('00000000-0000-4000-8000-000000000005.claim');
  });

  it('start is a no-op without retention', async () => {
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000006',
    });
    await sink.start();
    expect(fs.readdirSync(dir)).toHaveLength(0);
    await sink.dispose();
  });
});

// ---------------------------------------------------------------------------
// Concurrent appends: documented overshoot then convergence
// ---------------------------------------------------------------------------

describe('PerfSink + retention — concurrent overshoot (AC-7)', () => {
  it('concurrent appends overshoot, but next sweep converges', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000007',
      maxFiles: 2,
      maxBytes: 10_000_000,
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000007',
      retention,
    });
    await sink.start();

    // Write a record (creates today's file).
    await sink.write(operationRecord());

    // Create many old files to exceed the cap.
    for (let i = 0; i < 10; i++) {
      const dayKey = sequentialDayKey(i);
      fs.writeFileSync(path.join(dir, `perf-${dayKey}-old.jsonl`), 'data\n');
      const oldTime = Date.now() - (10 - i) * 3_600_000;
      fs.utimesSync(
        path.join(dir, `perf-${dayKey}-old.jsonl`),
        new Date(oldTime),
        new Date(oldTime),
      );
    }

    // Manual sweep converges.
    await retention.maintain(Date.now());

    const jsonlFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));

    // The overshoot is documented — not zero loss. But after the sweep,
    // the total should be at most maxFiles.
    expect(jsonlFiles.length).toBeLessThanOrEqual(2);

    await sink.dispose();
  });
});

// ---------------------------------------------------------------------------
// countNonStaleClaims available via retention
// ---------------------------------------------------------------------------

describe('PerfSink + retention — countNonStaleClaims', () => {
  it('retention.countNonStaleClaims reflects the current claim', async () => {
    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000008',
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000008',
      retention,
    });
    await sink.start();

    const now = Date.now();
    const count = await retention.countNonStaleClaims(now);
    expect(count).toBe(1); // this run's claim

    await sink.dispose();
  });
});

// ---------------------------------------------------------------------------
// Dispose always runs retention cleanup even when writeChain rejects (D8)
// ---------------------------------------------------------------------------

describe('PerfSink.dispose — always drains writeChain AND retention cleanup', () => {
  it('retention claim is removed even when an internal write error rejects the chain', async () => {
    // A filesystem port whose appendFile throws a NON-errno error (no .code).
    // This is an internal/programming error that rethrows through write(),
    // rejecting the writeChain. dispose() must still run retention.dispose()
    // (removing the claim and stopping the maintenance timer).
    const internalErrorFs: {
      ensureDir(d: string): Promise<void>;
      openExclusive(p: string, mode: number): Promise<void>;
      appendFile(p: string, data: string, mode: number): Promise<void>;
    } = {
      async ensureDir(d: string): Promise<void> {
        try {
          await fs.promises.access(d);
        } catch {
          await fs.promises.mkdir(d, { recursive: true, mode: 0o700 });
        }
      },
      async openExclusive(p: string, mode: number): Promise<void> {
        const fd = await fs.promises.open(p, 'wx', mode);
        await fd.close();
      },
      async appendFile(): Promise<void> {
        throw new Error('internal serialization bug');
      },
    };

    const retention = new PerfRetention({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000009',
    });
    const sink = new PerfSink({
      dir,
      runUuid: '00000000-0000-4000-8000-000000000009',
      retention,
      fs: internalErrorFs,
      onDiagnostic: () => {},
    });
    await sink.start();

    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-000000000009.claim'),
      ),
    ).toBe(true);

    const writePromise = sink.write(operationRecord());
    await expect(writePromise).rejects.toThrow('internal serialization bug');

    await expect(sink.dispose()).rejects.toThrow('internal serialization bug');

    expect(
      fs.existsSync(
        path.join(dir, '00000000-0000-4000-8000-000000000009.claim'),
      ),
    ).toBe(false);
  });
});

function sequentialDayKey(index: number): string {
  const base = new Date(Date.UTC(2025, 0, 1));
  base.setUTCDate(base.getUTCDate() + index);
  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, '0');
  const day = String(base.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
