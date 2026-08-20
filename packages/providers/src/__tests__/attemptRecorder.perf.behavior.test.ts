/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving the AttemptRecorder invokes the PerfPhaseObserver
 * at exact lifecycle boundaries (P07, EVIDENCE-AC5).
 *
 * Real AttemptRecorder lifecycle (onAttemptStart/onAttemptEnd), real
 * PerfPhaseObserver seam. No mock theater.
 *
 * Proves:
 * - Provider attempt start/end boundaries from real lifecycle
 * - Retries → multiple attempt intervals
 * - Consumer abort → end boundary with 'aborted' status
 * - D8: observer invoked outside try/catch (fail-fast on observer error)
 * - SDK-disabled mode still notifies (observer invoked regardless of SDK state)
 * - Default-off: null observer → no notification
 * - Attempt boundary timestamps are the real monotonic start/end
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { AttemptRecorder } from '../logging/attemptRecorder.js';
import {
  setPerfPhaseObserver,
  getPerfPhaseObserver,
  type PerfPhaseObserver,
  type PerfProviderAttemptStartInfo,
  type PerfProviderAttemptEndInfo,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function createRecorder(wrapperOwned = true): AttemptRecorder {
  return new AttemptRecorder({
    providerName: 'test-provider',
    defaultModelName: 'test-model',
    config: undefined,
    logicalRequestId: 'req-perf-test',
    wrapperOwned,
  });
}

function capturingObserver(): {
  observer: PerfPhaseObserver;
  starts: PerfProviderAttemptStartInfo[];
  ends: PerfProviderAttemptEndInfo[];
} {
  const starts: PerfProviderAttemptStartInfo[] = [];
  const ends: PerfProviderAttemptEndInfo[] = [];
  const observer: PerfPhaseObserver = {
    onProviderAttemptStart: (info) => starts.push(info),
    onProviderAttemptEnd: (info) => ends.push(info),
    onToolCallCompleted: () => undefined,
  };
  return { observer, starts, ends };
}

describe('AttemptRecorder perf phase observer (P07)', () => {
  beforeEach(() => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    setPerfPhaseObserver(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPerfPhaseObserver(null);
  });

  it('notifies observer on attempt start and end (wrapperOwned, success)', () => {
    const { observer, starts, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.recordTokenBearingChunk(
      recorder.getCurrentAttemptId()!,
      undefined,
      'hello',
    );
    recorder.finalizeAttempt('success', 'test-model');

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0].attemptId).toBe(ends[0].attemptId);
    expect(ends[0].status).toBe('success');
    expect(ends[0].endMs).toBeGreaterThanOrEqual(starts[0].startMs);
  });

  it('notifies on consumer abort with "aborted" status', () => {
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.finalizeAttempt('aborted', 'test-model');

    expect(ends).toHaveLength(1);
    expect(ends[0].status).toBe('aborted');
  });

  it('notifies on error with "error" status', () => {
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.finalizeAttempt('error', 'test-model', undefined, 'boom');

    expect(ends).toHaveLength(1);
    expect(ends[0].status).toBe('error');
  });

  it('notifies once per attempt (dedup by attemptId via hasEmittedTerminal)', () => {
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.finalizeAttempt('success', 'test-model');
    // Second finalize is a no-op (hasEmittedTerminal guard).
    recorder.finalizeAttempt('error', 'test-model');

    expect(ends).toHaveLength(1);
  });

  it('notifies for each retry attempt (external lifecycle owner)', () => {
    const { observer, starts, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(false);
    // External lifecycle owner fires start/end per attempt.
    recorder.onAttemptStart({
      requestStartMs: 1000,
      attemptId: 'a1',
      attemptIndex: 0,
    });
    recorder.onAttemptEnd({
      attemptId: 'a1',
      attemptIndex: 0,
      start: 1000,
      completionMs: 2000,
      firstTokenMs: 1100,
      lastTokenMs: 1900,
      status: 'error',
      providerName: 'test-provider',
      modelName: 'test-model',
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      errorMessage: 'retry me',
    });

    recorder.onAttemptStart({
      requestStartMs: 2100,
      attemptId: 'a2',
      attemptIndex: 1,
    });
    recorder.onAttemptEnd({
      attemptId: 'a2',
      attemptIndex: 1,
      start: 2100,
      completionMs: 3000,
      firstTokenMs: 2200,
      lastTokenMs: 2900,
      status: 'success',
      providerName: 'test-provider',
      modelName: 'test-model',
      inputTokens: 200,
      outputTokens: 80,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
    });

    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(ends[0].attemptId).toBe('a1');
    expect(ends[1].attemptId).toBe('a2');
    expect(ends[0].status).toBe('error');
    expect(ends[1].status).toBe('success');
    // Interval boundaries from the real lifecycle start/end.
    expect(ends[0].startMs).toBe(1000);
    expect(ends[0].endMs).toBe(2000);
    expect(ends[1].startMs).toBe(2100);
    expect(ends[1].endMs).toBe(3000);
  });

  it('preserves token counts at the boundary', () => {
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(false);
    recorder.onAttemptStart({
      requestStartMs: 1000,
      attemptId: 'tok-1',
      attemptIndex: 0,
    });
    recorder.onAttemptEnd({
      attemptId: 'tok-1',
      attemptIndex: 0,
      start: 1000,
      completionMs: 2000,
      firstTokenMs: null,
      lastTokenMs: null,
      status: 'success',
      providerName: 'test-provider',
      modelName: 'test-model',
      inputTokens: 500,
      outputTokens: 120,
      cachedTokens: 10,
      thoughtsTokens: 5,
      toolTokens: 3,
    });

    expect(ends[0].inputTokens).toBe(500);
    expect(ends[0].outputTokens).toBe(120);
    // cachedTokens/thoughtsTokens/toolTokens are intentionally not forwarded
    // to the perf observer — only input/output totals are tracked.
    expect(ends[0]).not.toHaveProperty('cachedTokens');
  });

  it('SDK-disabled mode still notifies (observer invoked before SDK gate)', () => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.finalizeAttempt('success', 'test-model');

    // The observer must fire even when the SDK is disabled.
    expect(ends).toHaveLength(1);
  });

  it('default-off: null observer produces no notification and no crash', () => {
    setPerfPhaseObserver(null);
    expect(getPerfPhaseObserver()).toBeNull();

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.finalizeAttempt('success', 'test-model');
    // No crash, no observer to notify.
  });

  it('D8: observer error propagates (fail-fast, not swallowed)', () => {
    const throwingObserver: PerfPhaseObserver = {
      onProviderAttemptStart: () => undefined,
      onProviderAttemptEnd: () => {
        throw new Error('observer internal error');
      },
      onToolCallCompleted: () => undefined,
    };
    setPerfPhaseObserver(throwingObserver);

    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();

    // The observer error must propagate, NOT be swallowed by the
    // emitAttemptRecord try/catch.
    expect(() => recorder.finalizeAttempt('success', 'test-model')).toThrow(
      'observer internal error',
    );
  });

  it('D8: observer error on start propagates (fail-fast)', () => {
    const throwingObserver: PerfPhaseObserver = {
      onProviderAttemptStart: () => {
        throw new Error('observer start error');
      },
      onProviderAttemptEnd: () => undefined,
      onToolCallCompleted: () => undefined,
    };
    setPerfPhaseObserver(throwingObserver);

    const recorder = createRecorder(true);
    expect(() => recorder.ensureAttemptStarted()).toThrow(
      'observer start error',
    );
  });

  it('carries the logicalRequestId as promptId on start and end (D1 correlation)', () => {
    const { observer, starts, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = new AttemptRecorder({
      providerName: 'test-provider',
      defaultModelName: 'test-model',
      config: undefined,
      logicalRequestId: 'sess#agentic-loop#logical-req-1',
      wrapperOwned: true,
    });
    recorder.ensureAttemptStarted();
    recorder.finalizeAttempt('success', 'test-model');

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0].promptId).toBe('sess#agentic-loop#logical-req-1');
    expect(ends[0].promptId).toBe('sess#agentic-loop#logical-req-1');
  });

  it('carries the logicalRequestId as promptId for external lifecycle owner', () => {
    const { observer, starts, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const recorder = new AttemptRecorder({
      providerName: 'test-provider',
      defaultModelName: 'test-model',
      config: undefined,
      logicalRequestId: 'sess#agentic-loop#ext-req',
      wrapperOwned: false,
    });
    recorder.onAttemptStart({
      requestStartMs: 0,
      attemptId: 'ext-a1',
      attemptIndex: 0,
    });
    recorder.onAttemptEnd({
      attemptId: 'ext-a1',
      attemptIndex: 0,
      start: 0,
      completionMs: 100,
      firstTokenMs: null,
      lastTokenMs: null,
      status: 'success',
      providerName: 'test-provider',
      modelName: 'test-model',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
    });

    expect(starts[0].promptId).toBe('sess#agentic-loop#ext-req');
    expect(ends[0].promptId).toBe('sess#agentic-loop#ext-req');
  });

  // #3257: orchestrator-owned attempts (claudecode/anthropic) end with info
  // token metrics of zero — the orchestrator's notifyEnd carries none. The
  // perf observer must receive the counts resolved from the usage the
  // wrapper recorded, not the raw zeros.
  it('resolves zero info tokens from recorded usage for the perf observer (orchestrator shape)', () => {
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const usage: UsageStats = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    const recorder = createRecorder(false);
    recorder.onAttemptStart({
      requestStartMs: 1000,
      attemptId: 'zero-tok-1',
      attemptIndex: 0,
    });
    recorder.recordTokenBearingChunk('zero-tok-1', undefined, 'partial text');
    recorder.recordMetadataUsage('zero-tok-1', usage);
    recorder.onAttemptEnd({
      attemptId: 'zero-tok-1',
      attemptIndex: 0,
      start: 1000,
      completionMs: 2000,
      firstTokenMs: 1100,
      lastTokenMs: 1900,
      status: 'success',
      providerName: 'test-provider',
      modelName: 'test-model',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
    });

    expect(ends).toHaveLength(1);
    expect(ends[0].inputTokens).toBe(100);
    expect(ends[0].outputTokens).toBe(50);
  });

  it('wrapper-owned finalize still carries resolved counts to the perf observer', () => {
    const { observer, ends } = capturingObserver();
    setPerfPhaseObserver(observer);

    const usage: UsageStats = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
    const recorder = createRecorder(true);
    recorder.ensureAttemptStarted();
    recorder.recordMetadataUsage(recorder.getCurrentAttemptId()!, usage);
    recorder.finalizeAttempt('success', 'test-model');

    expect(ends).toHaveLength(1);
    expect(ends[0].inputTokens).toBe(100);
    expect(ends[0].outputTokens).toBe(50);
  });
});
