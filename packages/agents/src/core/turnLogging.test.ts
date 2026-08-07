/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { logModelOutputResponse } from './turnLogging.js';

function createRuntimeContext(logApiResponse: ReturnType<typeof vi.fn>) {
  return {
    state: {
      model: 'test-model',
      sessionId: 'session-id',
      runtimeId: 'runtime-id',
      provider: 'test-provider',
    },
    telemetry: { logApiResponse },
  } as unknown as AgentRuntimeContext;
}

describe('logModelOutputResponse', () => {
  it('serializes circular and BigInt response metadata without masking success', () => {
    const logApiResponse = vi.fn();
    const runtimeContext = createRuntimeContext(logApiResponse);
    const response: { usage?: undefined; metadata?: unknown } = {};
    response.metadata = { response, value: 10n };

    expect(() =>
      logModelOutputResponse(runtimeContext, 'prompt-id', 5, response),
    ).not.toThrow();
    expect(logApiResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        responseText: expect.stringContaining('[Circular]'),
      }),
    );
    expect(logApiResponse).toHaveBeenCalledWith(
      expect.objectContaining({ responseText: expect.stringContaining('10') }),
    );
  });
});
