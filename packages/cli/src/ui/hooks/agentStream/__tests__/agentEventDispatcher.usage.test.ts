/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import {
  dispatchAgentEvent,
  type AgentEventDeps,
} from '../agentEventDispatcher.js';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';

function usageDeps(metrics: UiTelemetryService): AgentEventDeps {
  return {
    setLastPromptTokenCount: (count) => metrics.setLastPromptTokenCount(count),
    addItem: () => {},
    flushPendingHistoryItem: () => {},
    pendingHistoryItemRef: { current: null },
    loopDetectedRef: { current: false },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    setLastAgentActivityTime: () => {},
    setThought: () => {},
    handleUserCancelledEvent: () => {},
    handleErrorEvent: () => {},
    handleChatCompressionEvent: () => {},
    handleFinishedNotice: () => {},
    handleMaxSessionTurnsEvent: () => {},
    handleContextWindowWillOverflowEvent: () => {},
    handleCitationEvent: () => {},
    handleStreamAttemptDiscarded: () => {},
  };
}

describe('dispatchAgentEvent usage events', () => {
  it('records public-wire promptTokenCount only through the supplied metric writer #2627', () => {
    const metrics = new UiTelemetryService();
    const sibling = new UiTelemetryService();
    dispatchAgentEvent(
      {
        type: 'usage',
        usage: {
          promptTokenCount: 4242,
          candidatesTokenCount: 8,
          totalTokenCount: 4250,
        },
      },
      usageDeps(metrics),
      Date.now(),
    );
    expect(metrics.getLastPromptTokenCount()).toBe(4242);
    expect(sibling.getLastPromptTokenCount()).toBe(0);
  });
});
