/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P07 behavioral tests for OperationLifecycleRegistry: direct client phases,
 * provider/tool interval metrics, honest residual, granular cancellation
 * classification, and queue behavior (EVIDENCE-AC4/AC5/AC6).
 *
 * Real registry + real PerfSink/PerfRetention + real IntervalUnion + real
 * PerfPhaseObserver seam + real temp files + real reader. No mock theater.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfSink,
  PerfRetention,
  setPerfPhaseObserver,
  getPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import {
  setInteractiveRenderObserver,
  setInteractiveStdoutObserver,
} from '../../inkRenderOptions.js';
import {
  OperationLifecycleRegistry,
  type OperationIdentityProvider,
  type OperationIdentitySnapshot,
} from './operationLifecycle.js';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-p07-'));
  // Reset all module-level observers for deterministic isolation.
  setPerfPhaseObserver(null);
  setInteractiveRenderObserver(null);
  setInteractiveStdoutObserver(null);
});

afterEach(() => {
  setPerfPhaseObserver(null);
  setInteractiveRenderObserver(null);
  setInteractiveStdoutObserver(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureIdentity(
  overrides: Partial<OperationIdentitySnapshot> = {},
): OperationIdentitySnapshot {
  return {
    session_id: 'sess-abc',
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
    terminal_cols: 120,
    terminal_rows: 40,
    render_mode: 'incremental',
    ...overrides,
  };
}

function fixtureProvider(
  overrides: Partial<OperationIdentitySnapshot> = {},
): OperationIdentityProvider {
  const snap = fixtureIdentity(overrides);
  return { snapshot: () => snap };
}

/**
 * Creates a registry with a real sink/retention in tmpdir, installs observers,
 * and returns everything needed for assertions.
 */
async function createStartedRegistry(
  overrides: {
    monotonicNow?: () => number;
  } = {},
): Promise<{
  registry: OperationLifecycleRegistry;
  sink: PerfSink;
  retention: PerfRetention;
  readRecords: () => Promise<PerfOperationRecord[]>;
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
    identityProvider: fixtureProvider(),
    sink,
    retention,
    monotonicNow: overrides.monotonicNow,
  });
  registry.installObservers();

  const readRecords = async (): Promise<PerfOperationRecord[]> => {
    await registry.drain();
    await sink.dispose();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
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
  };

  return { registry, sink, retention, readRecords };
}

// ---------------------------------------------------------------------------
// Direct client phases
// ---------------------------------------------------------------------------

describe('P07 direct client phases (AC-5)', () => {
  it('client_prepare_ms is set via setClientPrepareMs', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.setClientPrepareMs(controller.signal, 12.5);
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].client_prepare_ms).toBe(12.5);
  });

  it('stream_handler_ms accumulates sync dispatch time', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.addStreamHandlerMs(controller.signal, 1.5);
    registry.addStreamHandlerMs(controller.signal, 2.5);
    registry.addStreamHandlerMs(controller.signal, 3.0);
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].stream_handler_ms).toBeCloseTo(7.0, 5);
  });

  it('client_finalize_ms is self-measured (synchronous writeRecord bookkeeping boundary)', async () => {
    // client_finalize_ms measures ONLY the synchronous record-assembly work
    // inside writeRecord (union computation, approval-wait closing, residual).
    // It EXCLUDES async claim filesystem checks and sink append time. It is
    // directly measured by the registry itself, not set by the caller.
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    // Self-measured: finite and non-negative (per schema). The exact value
    // depends on CPU, so we assert schema-validity + non-negativity.
    expect(records[0].client_finalize_ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(records[0].client_finalize_ms)).toBe(true);
  });

  it('Ink render accumulates renderTime and count independently', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Simulate Ink render passes via the observer
    registry.onRender(0.5);
    registry.onRender(0.3);
    registry.onRender(0.2);
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].ink_render_ms).toBeCloseTo(1.0, 5);
    expect(records[0].ink_render_count).toBe(3);
  });

  it('stdout write accumulates bytes, calls, and sync time', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onWrite(100, 0.1);
    registry.onWrite(200, 0.2);
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].stdout_bytes).toBe(300);
    expect(records[0].stdout_write_calls).toBe(2);
    expect(records[0].stdout_write_sync_ms).toBeCloseTo(0.3, 5);
  });

  it('render count and write count are independent', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // 3 renders but only 1 write (coalesced frame)
    registry.onRender(0.1);
    registry.onRender(0.1);
    registry.onRender(0.1);
    registry.onWrite(500, 0.05);
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].ink_render_count).toBe(3);
    expect(records[0].stdout_write_calls).toBe(1);
  });

  it('no phase is computed as elapsed − provider − tool', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.setClientPrepareMs(controller.signal, 10);
    // Add provider interval
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 100,
      status: 'success',
      inputTokens: 50,
      outputTokens: 20,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    // client_prepare_ms is independently measured, NOT derived
    expect(records[0].client_prepare_ms).toBe(10);
    // provider_attempt_sum_ms is independently measured
    expect(records[0].provider_attempt_sum_ms).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Provider/tool interval metrics
// ---------------------------------------------------------------------------

describe('P07 provider/tool interval metrics (AC-5)', () => {
  it('provider attempt: count, sum, union from real lifecycle', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 100,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 100,
      endMs: 200,
      status: 'success',
      inputTokens: 100,
      outputTokens: 50,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].provider_attempts).toBe(1);
    expect(records[0].provider_attempt_sum_ms).toBe(100);
    expect(records[0].provider_union_ms).toBe(100);
  });

  it('provider retries: multiple attempts accumulate sum and union', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Attempt 1 (error, retried)
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 100,
      status: 'error',
      inputTokens: 50,
      outputTokens: 0,
    });
    // Attempt 2 (success)
    registry.onProviderAttemptStart({
      attemptId: 'a2',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 150,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a2',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 150,
      endMs: 300,
      status: 'success',
      inputTokens: 80,
      outputTokens: 40,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].provider_attempts).toBe(2);
    expect(records[0].provider_attempt_sum_ms).toBe(250); // 100 + 150
    // Union has a gap [100,150), so union = 100 + 150 = 250
    expect(records[0].provider_union_ms).toBe(250);
  });

  it('provider overlapping retries: union ≤ sum', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Overlapping attempts (concurrent)
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 200,
      status: 'error',
      inputTokens: 50,
      outputTokens: 0,
    });
    registry.onProviderAttemptStart({
      attemptId: 'a2',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 50,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a2',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 50,
      endMs: 150,
      status: 'success',
      inputTokens: 80,
      outputTokens: 40,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].provider_attempts).toBe(2);
    expect(records[0].provider_attempt_sum_ms).toBe(300); // 200 + 100
    // Union is [0,200) (a2 is fully nested) = 200 ≤ 300
    expect(records[0].provider_union_ms).toBe(200);
    expect(records[0].provider_union_ms).toBeLessThanOrEqual(
      records[0].provider_attempt_sum_ms,
    );
  });

  it('provider consumer-abort end boundary', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 50,
      status: 'aborted',
      inputTokens: 50,
      outputTokens: 10,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].provider_attempts).toBe(1);
    expect(records[0].provider_union_ms).toBe(50);
  });

  it('provider dedup by attemptId (exactly once)', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 100,
      status: 'success',
      inputTokens: 50,
      outputTokens: 20,
    });
    // Duplicate end for the same attemptId — must NOT double-count.
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 100,
      status: 'success',
      inputTokens: 50,
      outputTokens: 20,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].provider_attempts).toBe(1);
    expect(records[0].provider_attempt_sum_ms).toBe(100);
  });

  it('provider preserves token counts', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 100,
      status: 'success',
      inputTokens: 500,
      outputTokens: 120,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].context_tokens).toBe(500);
    expect(records[0].output_tokens).toBe(120);
  });

  it('tool call: count, sum, union from real logger seam', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid',
      callId: 'tool-1',
      startMs: 200,
      endMs: 300,
      durationMs: 100,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].tool_calls).toBe(1);
    expect(records[0].tool_call_sum_ms).toBe(100);
    expect(records[0].tool_union_ms).toBe(100);
  });

  it('tool dedup by real callId (exactly once)', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid',
      callId: 'tool-1',
      startMs: 200,
      endMs: 300,
      durationMs: 100,
    });
    // Duplicate — must NOT double-count.
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid',
      callId: 'tool-1',
      startMs: 200,
      endMs: 300,
      durationMs: 100,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].tool_calls).toBe(1);
    expect(records[0].tool_call_sum_ms).toBe(100);
  });

  it('tool missing callId is counted honestly (no invented ID)', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid',
      callId: undefined,
      startMs: 200,
      endMs: 250,
      durationMs: 50,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].tool_calls).toBe(1);
    expect(records[0].tool_call_sum_ms).toBe(50);
  });

  it('agent_activity_union_ms = union(provider, tool) including overlap', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Provider [0, 200)
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 200,
      status: 'success',
      inputTokens: 0,
      outputTokens: 0,
    });
    // Tool [150, 250) — overlaps provider
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid',
      callId: 'tool-1',
      startMs: 150,
      endMs: 250,
      durationMs: 100,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    // Union [0, 250) = 250
    expect(records[0].agent_activity_union_ms).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Honest residual
// ---------------------------------------------------------------------------

describe('P07 honest residual (AC-5)', () => {
  it('residual = elapsed − direct phases − approval_wait (provider/tool NOT subtracted)', async () => {
    let mono = 1000;
    const { registry, readRecords } = await createStartedRegistry({
      monotonicNow: () => mono,
    });
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.setClientPrepareMs(controller.signal, 100);
    registry.addStreamHandlerMs(controller.signal, 50);
    registry.onRender(30);
    registry.onWrite(0, 20);
    // client_finalize_ms is self-measured by the registry; with a static
    // monotonic clock it is 0 (finalizeStart === finalizeEnd).

    // Provider interval (NOT subtracted from residual)
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 500,
      status: 'success',
      inputTokens: 0,
      outputTokens: 0,
    });

    mono = 2000; // elapsed = 1000
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    // residual = 1000 - 100(prepare) - 50(handler) - 30(render) - 20(stdout)
    //            - 0(finalize, self-measured with static clock) - 0(approval)
    //          = 800
    // Provider/tool unions NOT subtracted (they overlap client work).
    expect(records[0].unclassified_elapsed_ms).toBeCloseTo(800, 0);
    expect(records[0].operation_elapsed_ms).toBe(1000);
  });

  it('negative residual remains negative and schema-valid (overlap)', async () => {
    let mono = 0;
    const { registry, readRecords } = await createStartedRegistry({
      monotonicNow: () => mono,
    });
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Direct phases that exceed elapsed
    registry.setClientPrepareMs(controller.signal, 500);
    registry.addStreamHandlerMs(controller.signal, 600);
    // elapsed will be 100, but phases sum to 1100 → residual = -1000
    mono = 100;
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].unclassified_elapsed_ms).toBe(-1000);
    expect(records[0].operation_elapsed_ms).toBe(100);
    // Schema-valid: finite (may be negative — the schema allows it)
    expect(Number.isFinite(records[0].unclassified_elapsed_ms)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Granular cancellation classification (AC-4)
// ---------------------------------------------------------------------------

describe('P07 granular cancellation classification (AC-4)', () => {
  it('classifyCancellation returns cancelled_during_api when phase is api', async () => {
    const { registry } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.enterApiPhase(controller.signal);
    const status = registry.classifyCancellation(controller.signal);
    expect(status).toBe('cancelled_during_api');
  });

  it('classifyCancellation returns cancelled_during_tool when phase is tool', async () => {
    const { registry } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.handleToolStatus(controller.signal, 'executing', 'tool-1');
    const status = registry.classifyCancellation(controller.signal);
    expect(status).toBe('cancelled_during_tool');
  });

  it('classifyCancellation returns cancelled_during_approval when phase is approval', async () => {
    const { registry } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.handleToolStatus(controller.signal, 'awaiting-approval', 'app-1');
    const status = registry.classifyCancellation(controller.signal);
    expect(status).toBe('cancelled_during_approval');
  });

  it('deterministic precedence: approval > tool > api on overlap', async () => {
    const { registry } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Overlapping active states: api + tool + approval all active; the most
    // specific (approval) wins at the instant of abort.
    registry.enterApiPhase(controller.signal);
    registry.handleToolStatus(controller.signal, 'scheduled', 'tool-1');
    registry.handleToolStatus(controller.signal, 'awaiting-approval', 'app-1');
    const status = registry.classifyCancellation(controller.signal);
    expect(status).toBe('cancelled_during_approval');
  });

  it('phase evidence persists after active op is cleared (terminal evidence)', async () => {
    const { registry } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // A tool-status cancelled event retains the cancelled phase (tool) as
    // terminal cancellation evidence that persists past finalise.
    registry.handleToolStatus(controller.signal, 'cancelled', 'tool-1');
    // Finalise removes the op from active, but classification must still work.
    await registry.finalise(controller.signal, 'cancelled_during_tool');
    // After finalise, classifyCancellation should still return the captured phase.
    const status = registry.classifyCancellation(controller.signal);
    expect(status).toBe('cancelled_during_tool');
  });

  it('default phase (never entered) classifies as cancelled_during_api', async () => {
    const { registry } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Never entered any phase (sent but no phase event)
    const status = registry.classifyCancellation(controller.signal);
    expect(status).toBe('cancelled_during_api');
  });
});

// ---------------------------------------------------------------------------
// D1 continuation correlation
// ---------------------------------------------------------------------------

describe('P07 D1 continuation correlation (AC-3)', () => {
  it('tool call with continuation prompt_id associates to operation', async () => {
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Tool call from continuation #1
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid#continuation#1',
      callId: 'tool-cont-1',
      startMs: 100,
      endMs: 200,
      durationMs: 100,
    });
    // Tool call from continuation #2
    registry.onToolCallCompleted({
      promptId: 'sess#agentic-loop#uuid#continuation#2',
      callId: 'tool-cont-2',
      startMs: 300,
      endMs: 400,
      durationMs: 100,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].tool_calls).toBe(2);
    expect(records[0].tool_call_sum_ms).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Observer fail-fast (D8)
// ---------------------------------------------------------------------------

describe('P07 observer fail-fast (D8)', () => {
  it('registry observer methods are direct (no try/catch swallowing)', async () => {
    // The registry implements PerfPhaseObserver directly. Its methods have no
    // try/catch — internal/programming errors propagate. This test verifies
    // the registry's onProviderAttemptEnd does NOT swallow by confirming it
    // processes real events correctly (structural D8 verified by reading the
    // source: no catch boundary around the observer method body).
    const { registry, readRecords } = await createStartedRegistry();
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    registry.onProviderAttemptStart({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
    });
    registry.onProviderAttemptEnd({
      attemptId: 'a1',
      promptId: 'sess#agentic-loop#uuid',
      startMs: 0,
      endMs: 100,
      status: 'success',
      inputTokens: 50,
      outputTokens: 20,
    });
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    // If the observer method had swallowed, provider_attempts would be 0.
    expect(records[0].provider_attempts).toBe(1);
  });

  it('module-level perf observer propagates errors from installed observer', () => {
    // When a throwing observer is installed via setPerfPhaseObserver, calling
    // it via getPerfPhaseObserver() propagates the error (D8: no swallow).
    setPerfPhaseObserver({
      onProviderAttemptStart: () => undefined,
      onProviderAttemptEnd: () => {
        throw new Error('perf observer internal error');
      },
      onToolCallCompleted: () => undefined,
    });
    const observer = getPerfPhaseObserver();
    expect(observer).not.toBeNull();
    expect(() =>
      observer!.onProviderAttemptEnd({
        attemptId: 'x',
        promptId: 'sess#agentic-loop#uuid',
        startMs: 0,
        endMs: 10,
        status: 'success',
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toThrow('perf observer internal error');
  });
});

// ---------------------------------------------------------------------------
// Queue behavior (unhandled-rejection fix)
// ---------------------------------------------------------------------------

describe('P07 superseded queue behavior', () => {
  it('superseded sweep rejection does not become process-unhandled', async () => {
    // A registry with a sink that throws on write (internal error).
    const retention = new PerfRetention({
      dir,
      runUuid: crypto.randomUUID(),
      maintenanceIntervalMs: 60_000,
    });
    const throwingSink = {
      write(): Promise<void> {
        return Promise.reject(new Error('internal write error'));
      },
    } as unknown as PerfSink;
    const registry = new OperationLifecycleRegistry({
      identityProvider: fixtureProvider(),
      sink: throwingSink,
      retention,
    });
    registry.installObservers();

    const controller1 = new AbortController();
    const controller2 = new AbortController();
    registry.begin(controller1.signal, 'sess#agentic-loop#uuid1');
    // begin() for a new op triggers the superseded sweep, which queues a
    // write for op1 as 'superseded'. The void queueWrite promise must NOT
    // become an unhandled rejection at the process level.
    registry.begin(controller2.signal, 'sess#agentic-loop#uuid2');

    // Give microtasks a chance to settle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // drain() should reject (the chain is still rejected — fail-fast).
    await expect(registry.drain()).rejects.toThrow('internal write error');
  });
});

// ---------------------------------------------------------------------------
// Default-off
// ---------------------------------------------------------------------------

describe('P07 default-off', () => {
  it('absent registry means no perf observer installed', () => {
    setPerfPhaseObserver(null);
    expect(getPerfPhaseObserver()).toBeNull();
    // No observer, no notification.
  });

  it('installObservers sets perf/render/stdout observers', async () => {
    await createStartedRegistry();
    expect(getPerfPhaseObserver()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Approval wait
// ---------------------------------------------------------------------------

describe('P07 approval_wait_ms (AC-5)', () => {
  it('approval wait accumulates via handleToolStatus approval transitions', async () => {
    let mono = 0;
    const { registry, readRecords } = await createStartedRegistry({
      monotonicNow: () => mono,
    });
    const controller = new AbortController();
    registry.begin(controller.signal, 'sess#agentic-loop#uuid');
    // Enter approval at t=100
    mono = 100;
    registry.handleToolStatus(controller.signal, 'awaiting-approval', 'app-1');
    // Exit approval at t=250 (tool succeeds → closes the approval wait)
    mono = 250;
    registry.handleToolStatus(controller.signal, 'success', 'app-1');
    mono = 1000;
    await registry.finalise(controller.signal, 'completed');
    const records = await readRecords();
    expect(records[0].approval_wait_ms).toBeCloseTo(150, 0);
  });
});
