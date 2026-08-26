/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { dispatchAgentEvent } from '../agentEventDispatcher.js';
import type { AgentEventDeps } from '../agentEventDispatcher.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';

describe('dispatchAgentEvent usage events', () => {
  it('records the public-wire promptTokenCount as the last prompt token count #2627', () => {
    // The public agent wire keeps Gemini-named usage fields (documented
    // stability carve-out). The dispatcher must keep reading that shape so
    // nonzero counts flow provider -> ApiResponseEvent -> public wire -> UI
    // telemetry after the internal vocabulary rename.
    const initial = uiTelemetryService.getLastPromptTokenCount();
    expect(initial).not.toBe(42);

    dispatchAgentEvent(
      {
        type: 'usage',
        usage: {
          promptTokenCount: 42,
          candidatesTokenCount: 8,
          totalTokenCount: 50,
        },
      },
      {} as AgentEventDeps,
      '',
      Date.now(),
    );

    expect(uiTelemetryService.getLastPromptTokenCount()).toBe(42);
  });
});
