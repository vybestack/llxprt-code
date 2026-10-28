/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  UiTelemetryService,
  type SessionMetricReads,
  type SessionMetricSubscriptions,
  type SessionMetricReset,
  type SessionMetricUpdates,
  type SessionMetricEventSink,
} from './uiTelemetry.js';
import { EVENT_API_RESPONSE } from './constants.js';
import { ApiResponseEvent } from './events/api-events.js';

function recordAttempt(sink: SessionMetricEventSink): void {
  const event = new ApiResponseEvent('model', 200, 'attempt', {
    inputTokenCount: 30,
    outputTokenCount: 10,
    totalTokenCount: 40,
  });
  event.provider_owned = true;
  sink.addEvent({ ...event, 'event.name': EVENT_API_RESPONSE });
}

describe('session metric ports', () => {
  it('projects events and prompt updates through separate read, subscribe and reset capabilities', () => {
    const metrics = new UiTelemetryService();
    const reads: SessionMetricReads = metrics;
    const subscriptions: SessionMetricSubscriptions = metrics;
    const reset: SessionMetricReset = metrics;
    const updates: SessionMetricUpdates = metrics;
    const sink: SessionMetricEventSink = metrics;
    const observed: number[] = [];
    const unsubscribe = subscriptions.subscribe(() => {
      observed.push(reads.getSessionSnapshot().totalInputTokens);
    });
    recordAttempt(sink);
    updates.setLastPromptTokenCount(30);
    expect(reads.getSessionSnapshot().totalInputTokens).toBe(30);
    expect(reads.getMetrics().models['model'].tokens.candidates).toBe(10);
    expect(reads.getLastPromptTokenCount()).toBe(30);
    reset.reset();
    expect(observed).toStrictEqual([30, 30, 0]);
    expect(reads.getSessionSnapshot().totalApiRequests).toBe(0);
    unsubscribe();
    recordAttempt(sink);
    expect(observed).toStrictEqual([30, 30, 0]);
  });
});
