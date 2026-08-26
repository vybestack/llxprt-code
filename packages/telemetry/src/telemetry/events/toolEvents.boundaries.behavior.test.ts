/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving ToolCallEvent preserves honest tool-call
 * boundaries (P07 contract, issue #3167 review finding B).
 *
 * Real ToolCallEvent construction + real logToolCall + real PerfPhaseObserver.
 *
 * Proves:
 * - Caller-supplied startMs/endMs are preserved exactly.
 * - Historical public event fields retain their duration-based fallback.
 * - A completed call without explicit boundaries still carries durationMs
 *   (count/sum contribution) but contributes no performance union endpoints.
 * - Production-conversion: staggered/completed calls lacking boundaries and
 *   explicit-boundary controls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { logToolCall } from '../loggers.js';
import { ToolCallEvent } from './tool-events.js';
import type { CompletedToolCallShape } from '../../internal/interfaces.js';
import * as sdk from '../sdk.js';
import * as uiTelemetry from '../uiTelemetry.js';
import {
  setPerfPhaseObserver,
  type PerfPhaseObserver,
  type PerfToolCallCompletedInfo,
} from '../../perf/perfPhaseObserver.js';

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
    durationMs: overrides.durationMs,
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

function eventDuration(event: ToolCallEvent): number {
  return (event.end_ms ?? 0) - (event.start_ms ?? 0);
}

const mockConfig = {
  getSessionId: () => 'test-session-id',
  getTargetDir: () => 'target-dir',
  getUsageStatisticsEnabled: () => true,
  getTelemetryEnabled: () => true,
  getTelemetryLogPromptsEnabled: () => true,
} as unknown as Parameters<typeof logToolCall>[0];

describe('ToolCallEvent honest boundaries (P07 contract, finding B)', () => {
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

  // --- Explicit boundaries are preserved ---

  it('preserves caller-supplied startMs/endMs exactly', () => {
    const event = new ToolCallEvent(
      makeCompletedCall({ startMs: 1000, endMs: 1050, durationMs: 50 }),
    );
    expect(event.start_ms).toBe(1000);
    expect(event.end_ms).toBe(1050);
    expect(event.duration_ms).toBe(50);
  });

  it('passes explicit startMs/endMs through to the observer', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    logToolCall(
      mockConfig,
      new ToolCallEvent(
        makeCompletedCall({ callId: 'c1', startMs: 200, endMs: 350 }),
      ),
    );

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].startMs).toBe(200);
    expect(toolCalls[0].endMs).toBe(350);
  });

  // --- Missing boundaries: NO invented interval ---

  it('retains event compatibility without exposing fallback boundaries to perf', () => {
    const event = new ToolCallEvent(makeCompletedCall({ durationMs: 100 }));
    expect(event.duration_ms).toBe(100);
    expect(typeof event.start_ms).toBe('number');
    expect(typeof event.end_ms).toBe('number');
    expect(eventDuration(event)).toBe(100);
    expect(event.getPerfBoundaries()).toStrictEqual({
      startMs: undefined,
      endMs: undefined,
    });
  });

  it('does NOT invent start_ms/end_ms when durationMs is zero', () => {
    const event = new ToolCallEvent(makeCompletedCall({ durationMs: 0 }));
    expect(event.duration_ms).toBe(0);
    expect(event.start_ms).toBeUndefined();
    expect(event.end_ms).toBeUndefined();
  });

  it('does NOT invent start_ms/end_ms when durationMs is undefined', () => {
    const event = new ToolCallEvent(makeCompletedCall({}));
    expect(event.duration_ms).toBe(0);
    expect(event.start_ms).toBeUndefined();
    expect(event.end_ms).toBeUndefined();
  });

  it('observer receives undefined startMs/endMs (no invented endpoints) for boundary-less call', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    logToolCall(
      mockConfig,
      new ToolCallEvent(makeCompletedCall({ callId: 'c2', durationMs: 250 })),
    );

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].startMs).toBeUndefined();
    expect(toolCalls[0].endMs).toBeUndefined();
    // duration still preserved — the call still contributes count/sum.
    expect(toolCalls[0].durationMs).toBe(250);
  });

  // --- Partial boundaries: only both-present counts as explicit ---

  it('does not expose a partial start boundary to the perf observer', () => {
    const event = new ToolCallEvent(
      makeCompletedCall({ startMs: 500, durationMs: 100 }),
    );
    expect(event.duration_ms).toBe(100);
    expect(event.getPerfBoundaries()).toStrictEqual({
      startMs: undefined,
      endMs: undefined,
    });
  });

  it('does not expose a partial end boundary to the perf observer', () => {
    const event = new ToolCallEvent(
      makeCompletedCall({ endMs: 600, durationMs: 100 }),
    );
    expect(event.duration_ms).toBe(100);
    expect(event.getPerfBoundaries()).toStrictEqual({
      startMs: undefined,
      endMs: undefined,
    });
  });

  // --- Production conversion: staggered calls ---

  it('staggered completed calls without boundaries contribute duration but no endpoints', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    // Three tool calls completing at different times, none with explicit
    // monotonic boundaries — the production conversion path.
    for (const [i, dur] of [50, 120, 200].entries()) {
      logToolCall(
        mockConfig,
        new ToolCallEvent(
          makeCompletedCall({ callId: `stagger-${i}`, durationMs: dur }),
        ),
      );
    }

    expect(toolCalls).toHaveLength(3);
    // Every call contributes its duration (count/sum)...
    expect(toolCalls.map((t) => t.durationMs)).toStrictEqual([50, 120, 200]);
    // ...but none carries an invented interval endpoint.
    for (const info of toolCalls) {
      expect(info.startMs).toBeUndefined();
      expect(info.endMs).toBeUndefined();
    }
  });

  it('mixed: explicit-boundary and boundary-less calls coexist honestly', () => {
    const { observer, toolCalls } = capturingObserver();
    setPerfPhaseObserver(observer);

    // Call with explicit boundaries.
    logToolCall(
      mockConfig,
      new ToolCallEvent(
        makeCompletedCall({ callId: 'explicit', startMs: 10, endMs: 60 }),
      ),
    );
    // Call without boundaries.
    logToolCall(
      mockConfig,
      new ToolCallEvent(
        makeCompletedCall({ callId: 'implicit', durationMs: 90 }),
      ),
    );

    expect(toolCalls).toHaveLength(2);
    const explicit = toolCalls.find((t) => t.callId === 'explicit')!;
    const implicit = toolCalls.find((t) => t.callId === 'implicit')!;
    expect(explicit.startMs).toBe(10);
    expect(explicit.endMs).toBe(60);
    expect(implicit.startMs).toBeUndefined();
    expect(implicit.endMs).toBeUndefined();
  });
});
