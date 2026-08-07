/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — cancellation must be marked as a failure at its real source.
 * buildCancelledTransition and buildCancelAllEntry produce the cancelled
 * ToolResponseBlock; both must set the top-level `error` marker so a cancelled
 * call in a mixed batch reaches the provider as a failure (AgenticLoop only
 * short-circuits when EVERY agent tool is cancelled). These tests drive the
 * REAL builders (not a hand-crafted block) with a real MockTool and assert on
 * the produced CancelledToolCall (AC18).
 */

import { describe, it, expect } from 'bun:test';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import type {
  ExecutingToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  buildCancelledTransition,
  buildCancelAllEntry,
} from './status-transitions.js';

function makeRequest(): ToolCallRequestInfo {
  return {
    callId: 'call-cancel',
    name: 'cancel-test',
    args: {},
    isClientInitiated: false,
    prompt_id: 'prompt-1',
    agentId: 'agent-1',
  };
}

/** Real tool + invocation so the produced CancelledToolCall is well-formed. */
function makeToolAndInvocation(): {
  tool: ExecutingToolCall['tool'];
  invocation: ExecutingToolCall['invocation'];
} {
  const tool = new MockTool('cancel-test');
  const invocation = tool.build({});
  return { tool, invocation };
}

function makeExecutingCall(): ExecutingToolCall {
  const { tool, invocation } = makeToolAndInvocation();
  return {
    status: 'executing',
    request: makeRequest(),
    tool,
    invocation,
  };
}

function responseBlockError(call: ToolCall): string | undefined {
  const block = call.response.responseParts[0];
  if (block.type !== 'tool_response') {
    throw new Error(`expected tool_response, got ${String(block.type)}`);
  }
  return block.error;
}

describe('status-transitions — cancellation failure marker (issue #3063)', () => {
  it('buildCancelledTransition marks the cancelled call as a failure (AC18)', () => {
    const executingCall = makeExecutingCall();
    const reason = 'user requested';

    const cancelled = buildCancelledTransition(
      {
        request: executingCall.request,
        tool: executingCall.tool,
        invocation: executingCall.invocation,
      },
      reason,
      'executing',
      executingCall,
    );

    expect(cancelled.status).toBe('cancelled');
    const marker = responseBlockError(cancelled);
    // The marker carries the reason text the builder already produces; the
    // user-visible reason string is unchanged.
    expect(marker).toBe(`[Operation Cancelled] Reason: ${reason}`);
  });

  it('buildCancelAllEntry marks the cancelled call as a failure (AC18)', () => {
    const executingCall = makeExecutingCall();

    const cancelled = buildCancelAllEntry(executingCall);

    expect(cancelled.status).toBe('cancelled');
    const marker = responseBlockError(cancelled);
    expect(marker).toBe('Tool call cancelled by user.');
  });
});
