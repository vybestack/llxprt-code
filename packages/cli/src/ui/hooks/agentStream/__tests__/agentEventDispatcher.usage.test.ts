/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { dispatchAgentEvent } from '../agentEventDispatcher.js';
import type { AgentEventDeps } from '../agentEventDispatcher.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';

describe('dispatchAgentEvent usage events', () => {
  // The telemetry service is a shared singleton: capture and restore its
  // state so this test neither depends on nor leaks into other tests.
  let initialCount: number | undefined;

  afterEach(() => {
    if (initialCount !== undefined) {
      uiTelemetryService.setLastPromptTokenCount?.(initialCount);
    }
  });

  it('records the public-wire promptTokenCount as the last prompt token count #2627', () => {
    // The public agent wire keeps Gemini-named usage fields (documented
    // stability carve-out). The dispatcher must keep reading that shape so
    // nonzero counts flow provider -> ApiResponseEvent -> public wire -> UI
    // telemetry after the internal vocabulary rename.
    initialCount = uiTelemetryService.getLastPromptTokenCount();
    // Pick a value distinct from whatever earlier tests left behind.
    const expectedCount = initialCount === 4242 ? 4243 : 4242;

    dispatchAgentEvent(
      {
        type: 'usage',
        usage: {
          promptTokenCount: expectedCount,
          candidatesTokenCount: 8,
          totalTokenCount: expectedCount + 8,
        },
      },
      {} as AgentEventDeps,
      '',
      Date.now(),
    );

    expect(uiTelemetryService.getLastPromptTokenCount()).toBe(expectedCount);
  });
});
