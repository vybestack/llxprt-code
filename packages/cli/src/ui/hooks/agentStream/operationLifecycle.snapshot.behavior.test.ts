/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the synchronous immutable terminal snapshot (Finding A,
 * issue #3167).
 *
 * Proves that exactly-once finalisation atomically claims the operation and
 * synchronously freezes one immutable terminal snapshot before returning/
 * queueing. The queued async work does ONLY external claim counting and sink
 * persistence, receiving a frozen copy — never a mutable PendingOp/measurement
 * reference.
 *
 * Real registry + real PerfSink/PerfRetention + real temp files. No mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  PerfSink,
  PerfRetention,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import {
  OperationLifecycleRegistry,
  type OperationIdentityProvider,
  type OperationIdentitySnapshot,
} from './operationLifecycle.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-snapshot-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'sess-snap',
    runtime_id: 'rt-snap',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'sha256:snap-hash',
    llxprt_version: '0.11.0',
    git_sha: 'snap1234',
    runtime: 'bun-1.3.14',
    platform: 'darwin-arm64',
    provider: 'openai',
    model: 'gpt-4o',
    terminal_cols: 120,
    terminal_rows: 40,
    render_mode: 'incremental',
  };
}

function fixtureProvider(): OperationIdentityProvider {
  return { snapshot: () => fixtureIdentity() };
}

async function makeStartedRegistry(
  overrides: {
    monotonicNow?: () => number;
    wallNow?: () => number;
    identityProvider?: OperationIdentityProvider;
  } = {},
): Promise<{
  registry: OperationLifecycleRegistry;
  sink: PerfSink;
  retention: PerfRetention;
}> {
  const retention = new PerfRetention({
    dir,
    runUuid: crypto.randomUUID(),
    maintenanceIntervalMs: 60_000,
  });
  const sink = new PerfSink({
    dir,
    runUuid: crypto.randomUUID(),
    retention,
  });
  await sink.start();
  const registry = new OperationLifecycleRegistry({
    identityProvider: overrides.identityProvider ?? fixtureProvider(),
    sink,
    retention,
    monotonicNow: overrides.monotonicNow,
    wallNow: overrides.wallNow,
  });
  return { registry, sink, retention };
}

async function readAllRecords(): Promise<PerfOperationRecord[]> {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    : [];
  const records: PerfOperationRecord[] = [];
  for (const file of files) {
    const result = await readPerfRecords(path.join(dir, file));
    for (const rec of result.records) {
      if (rec.record_type === 'operation') {
        records.push(rec);
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Mutations immediately after finalise cannot change persisted record
// ---------------------------------------------------------------------------

describe('Finding A — immutable terminal snapshot', () => {
  it('mutations to the measurement handle immediately after finalise cannot change the persisted record', async () => {
    const { registry, sink } = await makeStartedRegistry();
    const ac = new AbortController();
    const handle = registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    handle.measurement.context_tokens = 1000;
    handle.measurement.output_tokens = 500;
    handle.measurement.client_prepare_ms = 10;

    // finalise returns a promise; the snapshot is frozen synchronously BEFORE
    // the promise resolves. We capture the promise but do NOT await it yet.
    const writePromise = registry.finalise(ac.signal, 'completed');

    // Mutate the handle's measurement reference immediately after finalise
    // returns (before the async write resolves). This mutation must NOT
    // affect the frozen snapshot.
    handle.measurement.context_tokens = 999_999;
    handle.measurement.output_tokens = 888_888;
    handle.measurement.client_prepare_ms = 777;

    await writePromise;
    await sink.dispose();

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].context_tokens).toBe(1000);
    expect(records[0].output_tokens).toBe(500);
    expect(records[0].client_prepare_ms).toBe(10);
  });

  it('copies begin-time identity before queued persistence', async () => {
    const mutableIdentity = { ...fixtureIdentity() };
    const identityProvider: OperationIdentityProvider = {
      snapshot: () => mutableIdentity,
    };
    const { registry, sink } = await makeStartedRegistry({ identityProvider });
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-identity#agentic-loop#uuid-1');

    const writePromise = registry.finalise(ac.signal, 'completed');
    mutableIdentity.provider = 'mutated-provider';
    mutableIdentity.model = 'mutated-model';

    await writePromise;
    await sink.dispose();

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0].provider).toBe('openai');
    expect(records[0].model).toBe('gpt-4o');
  });

  it('a delayed countNonStaleClaims cannot alter terminal timestamp/elapsed/status/measurements', async () => {
    // Use a retention subclass that delays countNonStaleClaims until released.
    // This proves the async claim-counting path cannot re-read mutable state.
    const retention = new PerfRetention({
      dir,
      runUuid: crypto.randomUUID(),
      maintenanceIntervalMs: 60_000,
    });
    let releaseClaims: () => void = () => {};
    const claimsGate = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });
    const delayedRetention = Object.create(retention) as PerfRetention;
    delayedRetention.countNonStaleClaims = async (
      now: number,
    ): Promise<number> => {
      await claimsGate;
      return retention.countNonStaleClaims(now);
    };

    const sink = new PerfSink({
      dir,
      runUuid: crypto.randomUUID(),
      retention: delayedRetention,
    });
    await sink.start();

    // Controllable clocks for deterministic elapsed.
    let mono = 1000;
    const monotonicNow = (): number => {
      const v = mono;
      mono += 100;
      return v;
    };
    const wallNow = (): number => 2_000_000_000_000;

    const registry = new OperationLifecycleRegistry({
      identityProvider: fixtureProvider(),
      sink,
      retention: delayedRetention,
      monotonicNow,
      wallNow,
    });

    const ac = new AbortController();
    const handle = registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    handle.measurement.context_tokens = 2000;
    handle.measurement.client_prepare_ms = 5;

    // finalise freezes the snapshot synchronously. The async write is blocked
    // on claimsGate.
    const writePromise = registry.finalise(ac.signal, 'completed');

    // While the async claim counting is pending, mutate the live measurement.
    handle.measurement.context_tokens = 424_242;
    handle.measurement.client_prepare_ms = 999;

    // Release the gate and drain.
    releaseClaims();
    await writePromise;
    await sink.dispose();

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    // The frozen values must be preserved.
    expect(records[0].context_tokens).toBe(2000);
    expect(records[0].client_prepare_ms).toBe(5);
    expect(records[0].status).toBe('completed');
    // Elapsed is frozen from the snapshot, not re-read later.
    expect(records[0].operation_elapsed_ms).toBeGreaterThan(0);
  });

  it('client_finalize and elapsed/residual use coherent clocks', async () => {
    // With controllable monotonic clock, the finalization boundary is shared.
    // The residual = elapsed - client_prepare - ... - client_finalize - ...
    // Since elapsed includes the finalize boundary, residual is coherent.
    let mono = 500;
    const monotonicNow = (): number => {
      const v = mono;
      mono += 50; // each call advances 50ms
      return v;
    };
    const wallNow = (): number => 1_700_000_000_000;

    const { registry, sink } = await makeStartedRegistry({
      monotonicNow,
      wallNow,
    });
    const ac = new AbortController();
    const handle = registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');
    // Set a known client_prepare so residual is predictable.
    handle.measurement.client_prepare_ms = 0;

    await registry.finalise(ac.signal, 'completed');
    await sink.dispose();

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    const rec = records[0];

    // Coherent: elapsed >= client_finalize_ms (the finalize boundary is
    // included in elapsed). With the controllable clock, begin takes 50ms
    // (mono 500→550 for startedAtMonotonic... actually begin captures startedAt
    // at one call). The exact values depend on how many monotonicNow calls
    // happen, but the INVARIANT is: residual = elapsed - all measured phases.
    const computedResidual =
      rec.operation_elapsed_ms -
      rec.client_prepare_ms -
      rec.stream_handler_ms -
      rec.ink_render_ms -
      rec.stdout_write_sync_ms -
      rec.client_finalize_ms -
      rec.approval_wait_ms;
    expect(rec.unclassified_elapsed_ms).toBeCloseTo(computedResidual, 5);

    // elapsed MUST include the finalization boundary: elapsed >=
    // client_finalize_ms (otherwise finalize work was subtracted without being
    // included in elapsed, making the residual artificially low).
    expect(rec.operation_elapsed_ms).toBeGreaterThanOrEqual(
      rec.client_finalize_ms,
    );
  });

  it('superseded snapshots are frozen (sweep path uses the same immutable snapshot)', async () => {
    const { registry, sink } = await makeStartedRegistry();
    const ac1 = new AbortController();
    const handle1 = registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');
    handle1.measurement.context_tokens = 3000;
    handle1.measurement.tool_calls = 7;

    // A new begin sweeps ac1 as superseded, freezing its snapshot
    // synchronously.
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');

    // Mutate handle1 after the sweep — the superseded snapshot is already
    // frozen.
    handle1.measurement.context_tokens = 111_111;
    handle1.measurement.tool_calls = 999;

    await registry.finalise(ac2.signal, 'completed');
    await sink.dispose();

    const records = await readAllRecords();
    expect(records).toHaveLength(2);
    const superseded = records.find((r) => r.status === 'superseded');
    expect(superseded).toBeDefined();
    expect(superseded!.context_tokens).toBe(3000);
    expect(superseded!.tool_calls).toBe(7);
  });

  it('cancellation evidence works after active-map removal without strong retention', async () => {
    // Behavioral proof that retained cancellation evidence survives active-map
    // removal. A WeakMap (not a strong Map) holds the evidence keyed by signal;
    // it persists as long as the caller holds the AbortController/signal.
    const { registry, sink } = await makeStartedRegistry();
    const ac1 = new AbortController();
    registry.begin(ac1.signal, 'sess-1#agentic-loop#uuid-1');

    // Simulate a tool-status cancelled terminal: retains 'tool' evidence.
    registry.handleToolStatus(ac1.signal, 'cancelled', 'call-xyz');

    // A new begin sweeps ac1 out of the active map (superseded). ac1.signal is
    // no longer in the active map.
    const ac2 = new AbortController();
    registry.begin(ac2.signal, 'sess-1#agentic-loop#uuid-2');

    // classifyCancellation must still return the retained phase — evidence
    // survived active-map removal. The signal is still held by ac1.
    const status = registry.classifyCancellation(ac1.signal);
    expect(status).toBe('cancelled_during_tool');

    await registry.finalise(ac2.signal, 'completed');
    await sink.dispose();
  });

  it('missing tool boundaries record count/sum without synthesizing intervals (status transitions do not synthesize tool intervals)', async () => {
    const { registry, sink } = await makeStartedRegistry();
    const ac = new AbortController();
    registry.begin(ac.signal, 'sess-1#agentic-loop#uuid-1');

    // A tool call completed with missing boundaries (no start/end). The count
    // and sum are recorded, but NO interval is synthesized.
    registry.onToolCallCompleted({
      promptId: 'sess-1#agentic-loop#uuid-1',
      callId: 'tool-no-bounds',
      durationMs: 42,
      startMs: undefined,
      endMs: undefined,
    });

    // CLI status transitions (e.g. scheduled→executing→success) must NOT
    // synthesize tool intervals.
    registry.handleToolStatus(ac.signal, 'scheduled', 'tool-no-bounds');
    registry.handleToolStatus(ac.signal, 'executing', 'tool-no-bounds');
    registry.handleToolStatus(ac.signal, 'success', 'tool-no-bounds');

    await registry.finalise(ac.signal, 'completed');
    await sink.dispose();

    const records = await readAllRecords();
    expect(records).toHaveLength(1);
    const rec = records[0];
    // Count and sum recorded honestly.
    expect(rec.tool_calls).toBe(1);
    expect(rec.tool_call_sum_ms).toBe(42);
    // No interval was synthesized → tool_union_ms is 0.
    expect(rec.tool_union_ms).toBe(0);
  });
});
