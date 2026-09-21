/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  type AnyDeclarativeTool,
  type AnyToolInvocation,
  type ToolCallRequestInfo,
  type SuccessfulToolCall,
} from '@vybestack/llxprt-code-core';
import { mapToDisplay } from './toolMapping.js';
import { TOOL_RESULT_RETENTION_CAP_BYTES } from '../utils/toolResultRetention.js';

const mockTool = {
  name: 'test_tool',
  displayName: 'Test Tool',
  isOutputMarkdown: false,
} as unknown as AnyDeclarativeTool;

const mockInvocation = {
  getDescription: () => 'Calling test_tool',
} as unknown as AnyToolInvocation;

function largeBody(bytes: number, turn: number): string {
  const chunk = `turn${turn}-abcdefghij`;
  const repeats = Math.ceil(bytes / chunk.length);
  return chunk.repeat(repeats).slice(0, bytes);
}

/**
 * Commits one synthetic turn through the live display-construction boundary
 * (`mapToDisplay`, the same call `onAllToolCallsComplete` makes) and returns
 * the retained display body.
 */
function commitTurn(turn: number, bodyBytes: number): string {
  const trackedCall = {
    status: 'success',
    request: {
      callId: `call-${turn}`,
      name: 'test_tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'p1',
      agentId: 'request-agent',
    } as ToolCallRequestInfo,
    tool: mockTool,
    invocation: mockInvocation,
    response: {
      callId: `call-${turn}`,
      responseParts: [],
      resultDisplay: largeBody(bodyBytes, turn),
      error: undefined,
      errorType: undefined,
    },
  } as SuccessfulToolCall;

  const display = mapToDisplay(trackedCall);
  const tool = display.tools[0];
  if (typeof tool.resultDisplay !== 'string') {
    throw new Error('expected a string result display');
  }
  return tool.resultDisplay;
}

/** Total UTF-8 bytes the UI retains for all committed display bodies. */
function retainedSessionBytes(turns: number, bodyBytes: number): number {
  let total = 0;
  for (let turn = 0; turn < turns; turn += 1) {
    total += Buffer.byteLength(commitTurn(turn, bodyBytes), 'utf8');
  }
  return total;
}

describe('toolMapping — long sessions retain bounded display memory (issue #3428)', () => {
  it('states the per-result retention cap as a small literal number', () => {
    expect(TOOL_RESULT_RETENTION_CAP_BYTES).toBe(64 * 1024);
  });

  it('keeps every retained display body at or under the cap', () => {
    const displays = Array.from({ length: 12 }, (_, turn) =>
      commitTurn(turn, 512 * 1024),
    );

    for (const display of displays) {
      expect(Buffer.byteLength(display, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    }
  });

  it('retains display bytes proportional to result count, not result size', () => {
    const totalSmallBodies = retainedSessionBytes(30, 256 * 1024);
    const totalDoubleBodies = retainedSessionBytes(30, 512 * 1024);
    const totalFewerTurns = retainedSessionBytes(15, 256 * 1024);

    // Doubling every body changes nothing once each is over the cap: every
    // capped body is cut to the same head+marker+tail size.
    expect(totalDoubleBodies).toBe(totalSmallBodies);

    // Halving the turn count halves the retained total: retention scales
    // with how many results exist, not how big they were.
    const ratio = totalSmallBodies / totalFewerTurns;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });
});
