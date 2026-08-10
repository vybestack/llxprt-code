/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so hook state updates are flushed.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P12 overhead harness — REAL useSubmitQuery fixture-stream overhead
 * (EVIDENCE-AC12, Item 8).
 *
 * Both ENABLED and DISABLED scenarios consume the SAME deterministic fixture
 * async stream workload through REAL useSubmitQuery orchestration.
 *
 * What is REAL in enabled mode:
 *   - useSubmitQuery (the actual hook with all turn-path control flow)
 *   - createInteractivePerfRuntime owner (single owner) with owner.start() so
 *     observer installation (stdout/render/phase) is genuinely performed —
 *     matching these comments rather than merely asserting it.
 *   - OperationLifecycleRegistry (begin/finalise/superseded sweep)
 *   - PerfSink + PerfRetention (real filesystem writes, claim lifecycle,
 *     maintenance timer cleared on dispose)
 *   - Record reader (tolerant JSONL parser)
 *
 * Ownership / leak discipline:
 *   - After the enabled workload, the owner is disposed BEFORE the disabled
 *     workload in deterministic order: observers null, claim removed, timer
 *     cleared. The owner is retained for afterEach emergency cleanup and
 *     disposed before the perf directory is removed.
 *   - The disabled workload runs with operationLifecycle undefined and no
 *     installed observers. It is asserted to add NO JSONL rows/artifacts by
 *     diffing the on-disk file set — not by inspecting a local empty array.
 *   - Both renderHook harnesses are unmounted under act().
 *
 * What is the EXTERNAL deterministic fixture:
 *   - runStreamRef.current: a deterministic async generator that yields N
 *     content chunks per turn and resolves. Both enabled and disabled paths
 *     consume the exact same generator function with the same chunk count.
 *   - prepareQueryForAgent/prepareTurnForQuery: stubbed to always proceed
 *     (same for both paths).
 *
 * Prints p50/p95/p99 + delta (evidence). Asserts counts, status, schema
 * validity, and cleanup only — no timing threshold.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useSubmitQuery, type UseSubmitQueryDeps } from '../useSubmitQuery.js';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import type {
  AgentClientContract,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { readPerfRecords } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfOperationRecord } from '@vybestack/llxprt-code-telemetry/perf/perfRecords.js';
import type { PerfScheduler } from '@vybestack/llxprt-code-telemetry/perf/index.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import {
  type OperationIdentitySnapshot,
  type OperationIdentityProvider,
} from '../operationLifecycle.js';
import {
  createInteractivePerfRuntime,
  type InteractivePerfRuntime,
} from '../../perf/interactivePerfRuntime.js';
import {
  getInteractiveStdoutObserver,
  getInteractiveRenderObserver,
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
} from '../../../inkRenderOptions.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Module mocks (same as useSubmitQuery.lifecycle) ────────────────────────

let shouldProceedValue = true;
let queryToSendValue: string | null = 'test-query';
let prepareQueryReject: unknown | null = null;
let prepareTurnReject: unknown | null = null;

void vi.mock('../useStreamEventHandlers.js', () => ({
  useStreamEventHandlers: () => ({
    processStreamEvent: vi.fn(),
    displayUserMessage: vi.fn(),
    prepareQueryForAgent: vi.fn().mockImplementation(() => {
      if (prepareQueryReject !== null) {
        return Promise.reject(prepareQueryReject);
      }
      return Promise.resolve({
        queryToSend: queryToSendValue,
        shouldProceed: shouldProceedValue,
      });
    }),
    handleLoopDetectedEvent: vi.fn(),
  }),
}));

void vi.mock('../../../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 0,
  }),
}));

void vi.mock('../turnPreparation.js', () => ({
  prepareTurnForQuery: vi.fn().mockImplementation(() => {
    if (prepareTurnReject !== null) {
      return Promise.reject(prepareTurnReject);
    }
    return Promise.resolve(undefined);
  }),
}));

void vi.mock('../streamUtils.js', () => ({
  handleSubmissionError: vi.fn(),
  processSlashCommandResult: vi.fn(),
}));

void vi.mock('../agentEventDispatcher.js', () => ({
  dispatchAgentEvent: vi.fn(() => ({ agentMessageBuffer: '' })),
}));

// ─── Deterministic fixture stream ───────────────────────────────────────────

/**
 * Deterministic async generator that yields CHUNKS_PER_TURN content chunks
 * then resolves. Both enabled and disabled scenarios consume this exact same
 * workload. The yield timing is deterministic (microtask gap per chunk).
 */
async function* deterministicFixtureStream(
  _msg: unknown,
  _signal: AbortSignal,
  _promptId: string,
): AsyncGenerator<void, void, unknown> {
  const CHUNKS = 10;
  for (let i = 0; i < CHUNKS; i++) {
    yield;
    // Deterministic microtask gap.
    await Promise.resolve();
  }
}

/**
 * Creates a deterministic runStream function that consumes the fixture stream.
 * Returns a promise that resolves after the stream completes. Both enabled
 * and disabled paths use this exact function.
 */
function makeDeterministicRunStream(): (
  msg: unknown,
  signal: AbortSignal,
  promptId: string,
) => Promise<void> {
  return async (_msg, _signal, _promptId) => {
    for await (const _chunk of deterministicFixtureStream(
      _msg,
      _signal,
      _promptId,
    )) {
      // The fixture stream just yields — the real runStream would dispatch
      // events. Here we prove the useSubmitQuery orchestration path
      // (begin → prepare → send → finalise) is exercised with the same
      // workload in both modes.
    }
  };
}

// ─── Identity fixture ───────────────────────────────────────────────────────

function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'sess-overhead',
    runtime_id: 'rt-overhead',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'proj-hash',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun',
    platform: `${process.platform}-${process.arch}`,
    provider: 'test-provider',
    model: 'test-model',
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'incremental',
  };
}

/**
 * Scheduler that counts timer clear() calls so the test can prove the owner's
 * retention maintenance interval is cancelled on dispose (no dangling timer).
 */
class CountingScheduler implements PerfScheduler {
  clearCount = 0;
  setInterval(_callback: () => Promise<void>, _ms: number) {
    return {
      unref() {},
      // Arrow captures the lexical `this` (the instance) without aliasing it.
      clear: () => {
        this.clearCount += 1;
      },
    };
  }
}

// ─── Harness ────────────────────────────────────────────────────────────────

const TURNS = 15;

let perfDir: string;
let owner: InteractivePerfRuntime | null = null;
let scheduler: CountingScheduler;

function createMockAgentClient(): AgentClientContract {
  return {
    getCurrentSequenceModel: () => 'test-model',
    getChat: () =>
      ({
        recordCompletedToolCalls: vi.fn(),
      }) as never,
  } as unknown as AgentClientContract;
}

function renderUseSubmitQuery(opts: {
  runStream: ReturnType<typeof makeDeterministicRunStream>;
  operationLifecycle: InteractivePerfRuntime['registry'] | undefined;
}): {
  result: { current: ReturnType<typeof useSubmitQuery> };
  unmount: () => void;
} {
  const hookDeps: UseSubmitQueryDeps = {
    runtime: createStreamRuntimeForTest(),
    agent: createMockAgentClient() as unknown as Agent,
    addItem: vi.fn().mockReturnValue(1),
    settings: {} as never,
    onDebugMessage: vi.fn(),
    onCancelSubmit: vi.fn(),
    setTurnCancelled: vi.fn(),
    onAuthError: vi.fn(),
    sanitizeContent: (text: string) => ({ text, blocked: false }),
    flushPendingHistoryItem: vi.fn(),
    pendingResponse: new PendingResponseBuffer(undefined),
    pendingHistoryItemRef: {
      current: null,
    } as React.MutableRefObject<HistoryItemWithoutId | null>,
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: { current: false },
    queuedSubmissionsRef: { current: [] },
    drainSuppressedRef: { current: false },
    enqueueSubmission: vi.fn(),
    enqueueSubmissionFirst: vi.fn(),
    requeueSubmission: vi.fn(),
    dequeueSubmission: vi.fn(),
    clearSubmissions: vi.fn(),
    tryReserveDrain: vi.fn().mockReturnValue(true),
    releaseDrain: vi.fn(),
    setPendingHistoryItem: vi.fn(),
    setIsResponding: vi.fn(),
    setInitError: vi.fn(),
    setThought: vi.fn(),
    setLastAgentActivityTime: vi.fn(),
    scheduleToolCalls: vi.fn(),
    abortActiveStream: vi.fn(),
    handleShellCommand: vi.fn().mockReturnValue(false),
    handleSlashCommand: vi.fn().mockResolvedValue(false),
    logger: null,
    shellModeActive: false,
    loopDetectedRef: { current: false },
    lastProfileNameRef: { current: undefined },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    abortControllerRef: { current: null },
    runStreamRef: { current: opts.runStream },
    submitQueryRef: { current: null },
    isResponding: false,
    streamingState: StreamingState.Idle,
    recordingIntegration: {
      flushAtTurnBoundary: vi.fn(),
    } as unknown as RecordingIntegration,
    operationLifecycle: opts.operationLifecycle,
  };

  return renderHook(() => useSubmitQuery(hookDeps));
}

async function runScenario(
  operationLifecycle: InteractivePerfRuntime['registry'] | undefined,
  turns: number,
): Promise<{ perOpMs: number[] }> {
  const runStream = makeDeterministicRunStream();
  const { result, unmount } = renderUseSubmitQuery({
    runStream,
    operationLifecycle,
  });

  const perOpMs: number[] = [];

  try {
    for (let i = 0; i < turns; i++) {
      const t0 = performance.now();
      await act(async () => {
        await result.current.submitQuery(
          `turn-${i}`,
          undefined,
          `sess-overhead#agentic-loop#turn-${i}`,
        );
      });
      perOpMs.push(performance.now() - t0);
    }
  } finally {
    // Unmount the renderHook harness under act (renderHook wraps unmount in act).
    unmount();
  }

  return { perOpMs };
}

/**
 * Reads every operation record from all JSONL files in the perf directory.
 */
async function readOperationRecords(
  dir: string,
): Promise<PerfOperationRecord[]> {
  const records: PerfOperationRecord[] = [];
  const names = await readdir(dir);
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const result = await readPerfRecords(join(dir, name));
    for (const r of result.records) {
      if (r.record_type === 'operation') {
        records.push(r);
      }
    }
  }
  return records;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('overhead harness — real useSubmitQuery fixture-stream overhead (Item 8)', () => {
  beforeEach(async () => {
    prepareQueryReject = null;
    prepareTurnReject = null;
    shouldProceedValue = true;
    queryToSendValue = 'test-query';
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);

    perfDir = await mkdtemp(join(tmpdir(), 'perf-overhead-'));
    scheduler = new CountingScheduler();
    owner = createInteractivePerfRuntime({
      enabled: true,
      memoryEnabled: false,
      perfDir,
      identityProvider: {
        snapshot: () => fixtureIdentity(),
      } satisfies OperationIdentityProvider,
      runUuid: 'overhead-enabled',
      __schedulerForTesting: scheduler,
    });
    // Real owner start: installs observers (stdout/render/phase), creates the
    // claim, and starts the retention maintenance timer — genuinely, not just
    // claimed in a comment.
    await owner!.start();
  });

  afterEach(async () => {
    // Emergency cleanup: dispose any owner still alive (e.g. a failed test)
    // BEFORE removing the perf directory.
    if (owner !== null) {
      try {
        await owner.dispose();
      } catch {
        // best-effort
      }
      owner = null;
    }
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
    try {
      await rm(perfDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('prints p50/p95/p99 + delta; enabled produces N records, disabled zero artifacts', async () => {
    // --- ENABLED scenario: real useSubmitQuery + real owner/registry/sink ---
    expect(getInteractiveStdoutObserver()).toBe(owner!.registry);
    expect(getInteractiveRenderObserver()).toBe(owner!.registry);
    expect(getPerfPhaseObserver()).toBe(owner!.registry);

    const enabledResult = await runScenario(owner!.registry, TURNS);

    // Deterministically drain pending writes through the real registry.
    await owner!.registry.drain();

    // Read enabled records from disk.
    const enabledRecords = await readOperationRecords(perfDir);

    // --- Dispose owner BEFORE the disabled workload, in deterministic order ---
    await owner!.dispose();
    owner = null;

    // Real disposal: observers cleared, timer cancelled, claim removed.
    expect(getInteractiveStdoutObserver()).toBe(null);
    expect(getInteractiveRenderObserver()).toBe(null);
    expect(getPerfPhaseObserver()).toBe(null);
    expect(scheduler.clearCount).toBeGreaterThanOrEqual(1);
    const filesAfterEnabled = await readdir(perfDir);
    expect(filesAfterEnabled.some((f) => f.endsWith('.claim'))).toBe(false);

    // Snapshot the artifact set produced by the enabled workload.
    const artifactsAfterEnabled = new Set(filesAfterEnabled);

    // --- DISABLED scenario: same fixture streams, NO operationLifecycle ---
    const disabledResult = await runScenario(undefined, TURNS);

    // No operationLifecycle ⇒ no installed observers remain.
    expect(getInteractiveStdoutObserver()).toBe(null);
    expect(getInteractiveRenderObserver()).toBe(null);
    expect(getPerfPhaseObserver()).toBe(null);

    // The disabled workload must not add any new JSONL rows or artifacts:
    // diff the on-disk file set rather than inspecting a local empty array.
    const filesAfterDisabled = await readdir(perfDir);
    expect(filesAfterDisabled.sort()).toEqual(
      [...artifactsAfterEnabled].sort(),
    );

    // --- PRINT evidence ---
    const enabledSorted = [...enabledResult.perOpMs].sort((a, b) => a - b);
    const disabledSorted = [...disabledResult.perOpMs].sort((a, b) => a - b);
    const ep50 = percentile(enabledSorted, 50);
    const ep95 = percentile(enabledSorted, 95);
    const ep99 = percentile(enabledSorted, 99);
    const dp50 = percentile(disabledSorted, 50);
    const dp95 = percentile(disabledSorted, 95);
    const dp99 = percentile(disabledSorted, 99);

    process.stdout.write(`
=== P12 Overhead Harness (REAL useSubmitQuery) ===
Turns per scenario: ${TURNS}
ENABLED  p50=${ep50.toFixed(4)}ms  p95=${ep95.toFixed(4)}ms  p99=${ep99.toFixed(4)}ms
DISABLED p50=${dp50.toFixed(4)}ms  p95=${dp95.toFixed(4)}ms  p99=${dp99.toFixed(4)}ms
DELTA    p50=${(ep50 - dp50).toFixed(4)}ms  p95=${(ep95 - dp95).toFixed(4)}ms  p99=${(ep99 - dp99).toFixed(4)}ms
=== End overhead evidence ===
`);

    // --- ASSERT stable invariants ---

    // 1. Enabled ⇒ exactly TURNS operation records on disk.
    expect(enabledRecords.length).toBe(TURNS);

    // 2. All enabled records have valid schema (status, operation_id, index).
    for (const rec of enabledRecords) {
      expect(rec.record_type).toBe('operation');
      expect(rec.status).toBe('completed');
      expect(rec.operation_id).toContain('sess-overhead#agentic-loop#turn-');
      expect(Number.isFinite(rec.session_operation_index)).toBe(true);
    }

    // 3. Session operation indices are 0..TURNS-1 (monotonic).
    const indices = enabledRecords
      .map((r) => r.session_operation_index)
      .sort((a, b) => a - b);
    for (let i = 0; i < TURNS; i++) {
      expect(indices[i]).toBe(i);
    }

    // 4. Disabled ⇒ no new perf records (real on-disk diff proven above).

    // 5. All per-op measurements are finite.
    for (const ms of enabledResult.perOpMs) {
      expect(Number.isFinite(ms)).toBe(true);
    }
    for (const ms of disabledResult.perOpMs) {
      expect(Number.isFinite(ms)).toBe(true);
    }
  });
});
