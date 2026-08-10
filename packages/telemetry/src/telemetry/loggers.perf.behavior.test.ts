/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving logToolCall invokes the PerfPhaseObserver at the
 * tool-call-completion lifecycle boundary (P07, EVIDENCE-AC5).
 *
 * Real ToolCallEvent construction + real logToolCall + real PerfPhaseObserver seam.
 *
 * Proves:
 * - Tool completion metrics use the real call_id/start_ms/end_ms/duration seam
 * - SDK-disabled mode still notifies
 * - D8: observer invoked outside try/catch (fail-fast on observer error)
 * - Default-off: null observer → no notification, no crash
 * - Characterizes missing call_id/timing honestly (no invented IDs)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { logToolCall } from './loggers.js';
import { ToolCallEvent } from './types.js';
import type { CompletedToolCallShape } from '../internal/interfaces.js';
import * as sdk from './sdk.js';
import * as uiTelemetry from './uiTelemetry.js';
import {
  setPerfPhaseObserver,
  getPerfPhaseObserver,
  type PerfPhaseObserver,
  type PerfToolCallCompletedInfo,
} from '../perf/perfPhaseObserver.js';

function makeCompletedCall(
  overrides: Partial<CompletedToolCallShape> & {
    callId?: string;
    promptId?: string;
    startMs?: number;
    endMs?: number;
    durationMs?: number;
  } = {},
): CompletedToolCallShape {
  return {
    status: 'success',
    request: {
      name: 'test_tool',
      args: {},
      callId: overrides.callId ?? 'call-1',
      isClientInitiated: true,
      prompt_id: overrides.promptId ?? 'sess-1#agentic-loop#uuid',
      agentId: 'primary',
    },
    response: {
      callId: overrides.callId ?? 'call-1',
      responseParts: [{ text: 'done' }],
    },
    tool: {},
    durationMs: overrides.durationMs ?? 50,
    startMs: overrides.startMs,
    endMs: overrides.endMs,
    ...overrides,
  };
}

function capturingObserver(): {
  observer: PerfPhaseObserver;
  toolCalls: PerfToolCallCompletedInfo[];
} {
  const toolCalls: PerfToolCallCompletedInfo[] = [];
  const observer: PerfPhaseObserver = {
    onProviderAttemptStart: () => undefined,
    onProviderAttemptEnd: () => undefined,
    onToolCallCompleted: (info) => toolCalls.push(info),
  };
  return { observer, toolCalls };
}

const mockConfig = {
  getSessionId: () => 'test-session-id',
  getTargetDir: () => 'target-dir',
  getUsageStatisticsEnabled: () => true,
  getTelemetryEnabled: () => true,
  getTelemetryLogPromptsEnabled: () => true,
} as unknown as Parameters<typeof logToolCall>[0];

describe('logToolCall perf phase observer (P07)', () => {
  beforeEach(() => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    vi.spyOn(uiTelemetry.uiTelemetryService, 'addEvent').mockImplementation(
      () => undefined,
    );
    setPerfPhaseObserver(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPerfPhaseObserver(null);
  });

  it('notifies observer with real call_id/start_ms/end_ms/duration', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    const call = makeCompletedCall({
      callId: 'call-abc',
      promptId: 'sess-1#agentic-loop#uuid#continuation#1',
      startMs: 1000,
      endMs: 1050,
      durationMs: 50,
    });
    logToolCall(mockConfig, new ToolCallEvent(call));

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].callId).toBe('call-abc');
    expect(toolCalls[0].startMs).toBe(1000);
    expect(toolCalls[0].endMs).toBe(1050);
    expect(toolCalls[0].durationMs).toBe(50);
    expect(toolCalls[0].promptId).toBe(
      'sess-1#agentic-loop#uuid#continuation#1',
    );
  });

  it('continuation prompt_id is carried for D1 association', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    const call = makeCompletedCall({
      promptId: 'sess-1#agentic-loop#uuid#continuation#2',
    });
    logToolCall(mockConfig, new ToolCallEvent(call));

    expect(toolCalls[0].promptId).toBe(
      'sess-1#agentic-loop#uuid#continuation#2',
    );
  });

  it('SDK-disabled mode still notifies', () => {
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    logToolCall(mockConfig, new ToolCallEvent(makeCompletedCall()));

    expect(toolCalls).toHaveLength(1);
  });

  it('default-off: null observer produces no notification and no crash', () => {
    setPerfPhaseObserver(null);
    expect(getPerfPhaseObserver()).toBeNull();
    logToolCall(mockConfig, new ToolCallEvent(makeCompletedCall()));
    // No crash.
  });

  it('D8: observer error propagates (fail-fast, not swallowed)', () => {
    const throwingObserver: PerfPhaseObserver = {
      onProviderAttemptStart: () => undefined,
      onProviderAttemptEnd: () => undefined,
      onToolCallCompleted: () => {
        throw new Error('observer internal error');
      },
    };
    setPerfPhaseObserver(throwingObserver);

    expect(() =>
      logToolCall(mockConfig, new ToolCallEvent(makeCompletedCall())),
    ).toThrow('observer internal error');
  });

  it('characterizes missing call_id honestly (undefined, not invented)', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    // Construct the event with a properly typed request, then override
    // call_id to undefined to test the optional-field code path without
    // erasing the required type on ToolCallRequest.callId.
    const event = new ToolCallEvent(makeCompletedCall());
    (event as { call_id?: string }).call_id = undefined;
    logToolCall(mockConfig, event);

    // call_id is undefined when the request has none — no invented ID.
    expect(toolCalls[0].callId).toBeUndefined();
  });
});
