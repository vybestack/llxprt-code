/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — every explicit failure producer must mark its failure on the
 * top-level ToolResponseBlock.error field. This drives the real, exported
 * malformed-`self_emitvalue` producer (handleEmitValueCall with missing args)
 * and asserts the produced ToolResponseBlock carries BOTH the model-facing
 * message in `result.error` AND the terse top-level marker (AC17). The marker
 * is authored explicitly via the shared toolFailureMarker helper; it is never
 * inferred from the shape of result.
 */

import { describe, it, expect } from '../testApi.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/DebugLogger.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  handleEmitValueCall,
  type EmitValueContext,
} from './subagentToolProcessing.js';

function makeCtx(): EmitValueContext {
  return {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.ERROR,
    },
    subagentId: 'test-agent',
    logger: new DebugLogger('test'),
  };
}

/**
 * Reads the two failure channels off the produced block through real
 * narrowing, throwing loudly if the block does not have the expected shape.
 */
function failureChannels(parts: ReturnType<typeof handleEmitValueCall>): {
  resultError: string;
  marker: string | undefined;
} {
  const block = parts[0];
  if (block.type !== 'tool_response') {
    throw new Error(`expected tool_response, got ${String(block.type)}`);
  }
  const result = block.result;
  if (typeof result !== 'object' || result === null || !('error' in result)) {
    throw new Error('tool_response result does not carry an error property');
  }
  const resultError = result.error;
  if (typeof resultError !== 'string') {
    throw new Error('tool_response result.error is not a string');
  }
  return { resultError, marker: block.error };
}

describe('handleEmitValueCall — malformed-emit failure marker (issue #3063)', () => {
  it('marks the malformed self_emitvalue failure on the top-level field (AC17)', () => {
    const parts = handleEmitValueCall(
      {
        callId: 'c-emit',
        name: 'self_emitvalue',
        args: {},
        isClientInitiated: true,
        prompt_id: 'p1',
        agentId: 'test-agent',
      },
      makeCtx(),
    );

    expect(parts).toHaveLength(1);
    const { resultError, marker } = failureChannels(parts);

    // The model-facing message still travels in result.error.
    expect(resultError).toContain('requires');
    // The failure is marked explicitly on the top-level field. The invariant
    // that matters is that the marker is a non-empty string, because
    // buildToolResponsePayload derives status "error" from its truthiness.
    // This producer authors only one message, so the marker carries that same
    // text rather than a separate terse variant.
    expect(typeof marker).toBe('string');
    expect(marker).toBeTruthy();
  });
});
