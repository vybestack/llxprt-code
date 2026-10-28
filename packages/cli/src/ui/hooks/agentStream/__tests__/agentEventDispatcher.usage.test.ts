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
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';
import { UiTelemetryService } from '@vybestack/llxprt-code-telemetry';

function usageDeps(metrics: UiTelemetryService): AgentEventDeps {
  return {
    observeAssistantMessageCommitted: () => {},
    setLastPromptTokenCount: (count) => metrics.setLastPromptTokenCount(count),
    addItem: () => {},
    sanitizeContent: (text) => ({ text, blocked: false }),
    flushPendingHistoryItem: () => {},
    pendingResponse: new PendingResponseBuffer(undefined),
    pendingHistoryItemRef: { current: null },
    thinkingBlocksRef: { current: [] },
    turnCancelledRef: { current: false },
    loopDetectedRef: { current: false },
    lastModelInfoRef: { current: null },
    lastModelIdentityRef: { current: null },
    setPendingHistoryItem: () => {},
    setLastAgentActivityTime: () => {},
    setThought: () => {},
    getContentPrefixIdentity: () => null,
    handleContentEvent: () => '',
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
      '',
      Date.now(),
    );
    expect(metrics.getLastPromptTokenCount()).toBe(4242);
    expect(sibling.getLastPromptTokenCount()).toBe(0);
  });
});
