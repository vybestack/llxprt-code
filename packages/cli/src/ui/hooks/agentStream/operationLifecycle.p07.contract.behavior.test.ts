/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P07 contract-correction behavioral tests (issue #3167).
 *
 * These tests pin the corrected contracts that the initial P07 pass got wrong:
 *
 * 1. Provider correlation MUST use prompt/logical-request identity
 *    (deriveOperationId(info.promptId)), NOT getFirstActiveOp. Unrelated
 *    prompt IDs and simultaneous attempts must NOT be misattributed to the
 *    foreground operation. Continuation prompt IDs collapse via the exact D1
 *    split.
 * 2. Live cancellation phases track REAL active state; a completed/rejected
 *    approval followed by ordinary API activity then abort classifies
 *    during_api. Retained terminal cancellation evidence is set ONLY by a
 *    cancellation terminal signal/event (tool-status cancelled, provider
 *    attempt aborted end). tool-status transitions are keyed by tool call ID.
 * 3. Tool interval honesty: a ToolCallEvent lacking start_ms/end_ms counts/
 *    sums its duration but does NOT synthesize an interval.
 *
 * Real registry + real PerfSink/PerfRetention + real temp files. No mock
 * theater.
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
  getInteractiveRenderObserver,
  getInteractiveStdoutObserver,
} from '../../inkRenderOptions.js';
import {
  OperationLifecycleRegistry,
  type OperationIdentityProvider,
  type OperationIdentitySnapshot,
} from './operationLifecycle.js';

let dir: string;
let activeSink: PerfSink | null = null;

describe('OperationLifecycleRegistry P07 contract test lifecycle', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-p07-contract-'));
    activeSink = null;
    setPerfPhaseObserver(null);
    setInteractiveRenderObserver(null);
    setInteractiveStdoutObserver(null);
  });

  afterEach(async () => {
    const errors: unknown[] = [];
    if (activeSink !== null) {
      try {
        await activeSink.dispose();
      } catch (err) {
        errors.push(err);
      }
      activeSink = null;
    }
    setPerfPhaseObserver(null);
    setInteractiveRenderObserver(null);
    setInteractiveStdoutObserver(null);
    fs.rmSync(dir, { recursive: true, force: true });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'p07 contract afterEach sink cleanup failed',
      );
    }
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

  async function createStartedRegistry(
    overrides: { monotonicNow?: () => number } = {},
  ): Promise<{
    registry: OperationLifecycleRegistry;
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
    activeSink = sink;
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
      activeSink = null;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      const records: PerfOperationRecord[] = [];
      for (const file of files) {
        const result = await readPerfRecords(path.join(dir, file));
        for (const rec of result.records) {
          if (rec.record_type === 'operation') records.push(rec);
        }
      }
      return records;
    };
    return { registry, readRecords };
  }

  // ---------------------------------------------------------------------------
  // 1. Provider correlation by prompt/logical-request identity (NOT
  //    getFirstActiveOp)
  // ---------------------------------------------------------------------------

  describe('P07 provider correlation by promptId (AC-3)', () => {
    it('attributes a provider attempt whose promptId derives to the active op', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'a1',
        startMs: 0,
        endMs: 100,
        status: 'success',
        inputTokens: 10,
        outputTokens: 5,
        promptId: 'sess#agentic-loop#uuid',
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      expect(records[0].provider_attempts).toBe(1);
    });

    it('continuation prompt IDs collapse to the same operation via D1 split', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid#continuation#1',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'a1',
        startMs: 0,
        endMs: 100,
        status: 'success',
        inputTokens: 0,
        outputTokens: 0,
        promptId: 'sess#agentic-loop#uuid#continuation#1',
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      expect(records[0].provider_attempts).toBe(1);
    });

    it('an unrelated prompt ID is NOT misattributed to the foreground op', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#fg');
      // A subagent / unrelated concurrent request with a different prompt ID.
      registry.onProviderAttemptStart({
        attemptId: 'sub-a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#unrelated-subagent',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'sub-a1',
        startMs: 0,
        endMs: 999,
        status: 'success',
        inputTokens: 777,
        outputTokens: 888,
        promptId: 'sess#agentic-loop#unrelated-subagent',
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      // The unrelated attempt must NOT have been attributed.
      expect(records[0].provider_attempts).toBe(0);
      expect(records[0].context_tokens).toBe(0);
      expect(records[0].output_tokens).toBe(0);
    });

    it('simultaneous retries attribute correctly while an unrelated attempt does not', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#fg');
      // Retry 1 (error) for the foreground op.
      registry.onProviderAttemptStart({
        attemptId: 'fg-a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#fg',
      });
      // An unrelated concurrent attempt interleaved.
      registry.onProviderAttemptStart({
        attemptId: 'sub-a1',
        startMs: 10,
        promptId: 'sess#agentic-loop#sub',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'fg-a1',
        startMs: 0,
        endMs: 50,
        status: 'error',
        inputTokens: 5,
        outputTokens: 0,
        promptId: 'sess#agentic-loop#fg',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'sub-a1',
        startMs: 10,
        endMs: 60,
        status: 'success',
        inputTokens: 999,
        outputTokens: 999,
        promptId: 'sess#agentic-loop#sub',
      });
      // Retry 2 (success) for the foreground op.
      registry.onProviderAttemptStart({
        attemptId: 'fg-a2',
        startMs: 100,
        promptId: 'sess#agentic-loop#fg',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'fg-a2',
        startMs: 100,
        endMs: 200,
        status: 'success',
        inputTokens: 20,
        outputTokens: 8,
        promptId: 'sess#agentic-loop#fg',
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      // Only the two foreground retries attribute; the unrelated one does not.
      expect(records[0].provider_attempts).toBe(2);
      expect(records[0].context_tokens).toBe(25); // 5 + 20
      expect(records[0].output_tokens).toBe(8); // 0 + 8
    });

    it('a provider attempt whose promptId matches NO active op is ignored', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#fg');
      // End without a matching start promptId — must be ignored entirely.
      registry.onProviderAttemptEnd({
        attemptId: 'ghost',
        startMs: 0,
        endMs: 10,
        status: 'success',
        inputTokens: 1,
        outputTokens: 1,
        promptId: 'sess#agentic-loop#no-such-op',
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      expect(records[0].provider_attempts).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Live cancellation phases — real active state + retained evidence
  // ---------------------------------------------------------------------------

  describe('P07 live cancellation phases (AC-4)', () => {
    it('executing tool-status classifies cancelled_during_tool', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_tool',
      );
    });

    it('awaiting-approval tool-status classifies cancelled_during_approval', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c1');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_approval',
      );
    });

    it('precedence approval > tool when both active (keyed by call ID)', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c2');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_approval',
      );
    });

    it('completed approval then API activity then abort classifies during_api', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      // Tool awaits approval, then is approved/executed/succeeded → approval
      // phase CLOSED.
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c1');
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      registry.handleToolStatus(controller.signal, 'success', 'c1');
      // Ordinary API activity resumes; abort must classify during_api, NOT
      // during_approval (the approval is no longer active).
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('rejected approval (error) closes the approval phase', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c1');
      registry.handleToolStatus(controller.signal, 'error', 'c1');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('tool-status cancelled retains the cancelled phase past finalise', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      // A cancellation terminal event retains the phase that was cancelled.
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      await registry.finalise(controller.signal, 'cancelled_during_tool');
      // Evidence persists after the active op is cleared.
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_tool',
      );
    });

    it('tool-status cancelled during approval retains cancelled_during_approval', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c1');
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      await registry.finalise(controller.signal, 'cancelled_during_approval');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_approval',
      );
    });

    it('provider attempt aborted end retains API cancellation evidence', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'a1',
        startMs: 0,
        endMs: 50,
        status: 'aborted',
        inputTokens: 0,
        outputTokens: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      await registry.finalise(controller.signal, 'cancelled_during_api');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('tool-status cancelled is stale once a provider attempt proves continuation (corrected contract)', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      // BEFORE continuation, the tool evidence is retained.
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_tool',
      );
      // A new provider attempt proves the operation continued past the tool
      // cancellation, so the tool evidence is stale and cleared. A later abort
      // classifies during_api (this is the corrected contract; the prior pass
      // incorrectly retained the tool evidence).
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('overlapping approval waits union into approval_wait_ms', async () => {
      let mono = 0;
      const { registry, readRecords } = await createStartedRegistry({
        monotonicNow: () => mono,
      });
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      mono = 100;
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c1');
      mono = 120;
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c2');
      mono = 200;
      // Close c1 (approval interval [100,200) = 100).
      registry.handleToolStatus(controller.signal, 'success', 'c1');
      mono = 250;
      // Close c2 (approval interval [120,250) = 130; overlaps c1).
      registry.handleToolStatus(controller.signal, 'success', 'c2');
      mono = 1000;
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      // Union of [100,200) and [120,250) = [100,250) = 150.
      expect(records[0].approval_wait_ms).toBeCloseTo(150, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Tool interval honesty
  // ---------------------------------------------------------------------------

  describe('P07 tool interval honesty (AC-5)', () => {
    it('missing start_ms/end_ms: counts + sums duration but no synthesized interval', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.onToolCallCompleted({
        promptId: 'sess#agentic-loop#uuid',
        callId: 't1',
        startMs: undefined,
        endMs: undefined,
        durationMs: 42,
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      expect(records[0].tool_calls).toBe(1);
      expect(records[0].tool_call_sum_ms).toBe(42);
      // No interval was synthesized from monotonicNow.
      expect(records[0].tool_union_ms).toBe(0);
    });

    it('present boundaries still union normally', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.onToolCallCompleted({
        promptId: 'sess#agentic-loop#uuid',
        callId: 't1',
        startMs: 100,
        endMs: 200,
        durationMs: 100,
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      expect(records[0].tool_union_ms).toBe(100);
    });

    it('each unidentifiable completed event (no callId) counts independently', async () => {
      const { registry, readRecords } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      // Two events with no callId — no ID is invented, so each counts.
      registry.onToolCallCompleted({
        promptId: 'sess#agentic-loop#uuid',
        callId: undefined,
        startMs: undefined,
        endMs: undefined,
        durationMs: 10,
      });
      registry.onToolCallCompleted({
        promptId: 'sess#agentic-loop#uuid',
        callId: undefined,
        startMs: undefined,
        endMs: undefined,
        durationMs: 20,
      });
      await registry.finalise(controller.signal, 'completed');
      const records = await readRecords();
      expect(records[0].tool_calls).toBe(2);
      expect(records[0].tool_call_sum_ms).toBe(30);
      expect(records[0].tool_union_ms).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Observer ownership — fail-fast on double install, identity-safe dispose
  // ---------------------------------------------------------------------------

  describe('P07 observer ownership (D8/AC-2)', () => {
    it('installObservers is idempotent for the same registry', async () => {
      const { registry } = await createStartedRegistry();
      // Already installed in createStartedRegistry.
      expect(() => registry.installObservers()).not.toThrow();
      expect(getPerfPhaseObserver()).toBe(registry);
    });

    it('a second registry installing while another owns throws (fail-fast)', async () => {
      const { registry } = await createStartedRegistry();
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
      const other = new OperationLifecycleRegistry({
        identityProvider: fixtureProvider(),
        sink,
        retention,
      });
      expect(() => other.installObservers()).toThrow(
        'single interactive owner',
      );
      // The first registry still owns the observers.
      expect(getPerfPhaseObserver()).toBe(registry);
      await sink.dispose();
    });

    it('dispose clears only its own observers (identity-safe)', async () => {
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
      const owner = new OperationLifecycleRegistry({
        identityProvider: fixtureProvider(),
        sink,
        retention,
      });
      owner.installObservers();
      // A non-owner registry that never installed must not clear the owner's
      // observers when it disposes.
      const nonOwner = new OperationLifecycleRegistry({
        identityProvider: fixtureProvider(),
        sink,
        retention,
      });
      await nonOwner.dispose();
      expect(getPerfPhaseObserver()).toBe(owner);
      expect(getInteractiveRenderObserver()).toBe(owner);
      expect(getInteractiveStdoutObserver()).toBe(owner);
      await owner.dispose();
      await sink.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Stale terminal cancellation evidence — provider-start clearing (AC-4)
  // ---------------------------------------------------------------------------

  describe('P07 stale terminal cancellation evidence (AC-4)', () => {
    it('a tool-status cancelled terminal is stale once a new provider attempt proves the operation continued', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      // Retained BEFORE the operation continues.
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_tool',
      );
      // A new provider attempt for the same operation proves the tool
      // cancellation did NOT terminate the operation → stale evidence cleared,
      // so a later independent API abort classifies during_api.
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
      // A later independent API abort now classifies during_api (not during_tool).
      registry.onProviderAttemptEnd({
        attemptId: 'a1',
        startMs: 0,
        endMs: 10,
        status: 'aborted',
        inputTokens: 0,
        outputTokens: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('clearing stale evidence does NOT clear current active tool state', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      // Two tools active; c1 is cancelled (terminal) but c2 stays active.
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      registry.handleToolStatus(controller.signal, 'executing', 'c2');
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      // A new provider attempt clears the stale tool evidence from c1's cancel.
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      // c2 is STILL active → classification remains during_tool.
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_tool',
      );
    });

    it('an approval-status cancelled terminal is also cleared by a provider start', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.handleToolStatus(controller.signal, 'awaiting-approval', 'c1');
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_approval',
      );
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('provider-aborted (api) terminal evidence is preserved across a later provider attempt start', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'a1',
        startMs: 0,
        endMs: 50,
        status: 'aborted',
        inputTokens: 0,
        outputTokens: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
      // A retry attempt must NOT clear the provider-aborted api evidence.
      registry.onProviderAttemptStart({
        attemptId: 'a2',
        startMs: 100,
        promptId: 'sess#agentic-loop#uuid',
      });
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_api',
      );
    });

    it('overlap precedence preserved: a tool cancel upgrades retained api evidence (tool > api)', async () => {
      const { registry } = await createStartedRegistry();
      const controller = new AbortController();
      registry.begin(controller.signal, 'sess#agentic-loop#uuid');
      registry.enterApiPhase(controller.signal);
      // API evidence retained first via a provider abort (no prior tool evidence,
      // so the start is a no-op clear).
      registry.onProviderAttemptStart({
        attemptId: 'a1',
        startMs: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      registry.onProviderAttemptEnd({
        attemptId: 'a1',
        startMs: 0,
        endMs: 50,
        status: 'aborted',
        inputTokens: 0,
        outputTokens: 0,
        promptId: 'sess#agentic-loop#uuid',
      });
      // A tool-status cancel for a still-active tool UPGRADES the retained
      // evidence to tool (overlap precedence: tool > api). No provider start
      // intervenes after the tool cancel, so the tool evidence is NOT stale.
      registry.handleToolStatus(controller.signal, 'executing', 'c1');
      registry.handleToolStatus(controller.signal, 'cancelled', 'c1');
      expect(registry.classifyCancellation(controller.signal)).toBe(
        'cancelled_during_tool',
      );
    });
  });
});
