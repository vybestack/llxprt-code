/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — a failed tool call must reach the provider layer marked as a
 * failure. buildToolResponsePayload derives `status` from the top-level
 * ToolResponseBlock.error marker. To prove the producer→provider chain cannot
 * drift apart, the failure block here is built by the REAL createErrorResponse
 * (not hand-crafted), then handed to buildToolResponsePayload. AC4 asserts the
 * status is "error", the terse marker surfaces as payload.error, AND the
 * model-facing remedy survives into payload.result.
 */

import { describe, it, expect } from 'bun:test';
import { buildToolResponsePayload } from './toolResponsePayload.js';
import { createErrorResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ToolResponseBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const REMEDY = 'File not found; check the path and try read_file again.';
const TERSE = 'file_not_found: /missing/path';

/** Builds a real failure block from the actual createErrorResponse producer. */
function failureBlock(): ToolResponseBlock {
  const request: ToolCallRequestInfo = {
    callId: 'call-fail',
    name: 'failingTool',
    args: {},
    isClientInitiated: false,
    prompt_id: 'prompt-1',
  };
  const response = createErrorResponse(
    request,
    new Error(TERSE),
    undefined,
    REMEDY,
  );
  const block = response.responseParts[0];
  if (block.type !== 'tool_response') {
    throw new Error(`expected tool_response, got ${String(block.type)}`);
  }
  return block;
}

describe('buildToolResponsePayload — tool failure fidelity (issue #3063)', () => {
  it('reports status "error", the terse marker, AND keeps the remedy in result for a producer-built block (AC4)', () => {
    const payload = buildToolResponsePayload(failureBlock());

    expect(payload.status).toBe('error');
    expect(payload.error).toBe(TERSE);
    // The model-facing remedy survives into the result channel — it is not
    // discarded now that the top-level marker exists.
    expect(payload.result).toContain(REMEDY);
  });

  it('reports status "success" and no error for a block with no top-level marker (AC8)', () => {
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-ok',
      toolName: 'okTool',
      result: { output: 'done' },
    };

    const payload = buildToolResponsePayload(block);

    expect(payload.status).toBe('success');
    expect(payload.error).toBeUndefined();
  });

  it('still reports status "error" for a synthetic cancellation block (AC9)', () => {
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-cancel',
      toolName: 'interruptedTool',
      result: null,
      error: 'Tool call interrupted or cancelled',
    };

    const payload = buildToolResponsePayload(block);

    expect(payload.status).toBe('error');
    expect(payload.error).toBe('Tool call interrupted or cancelled');
  });
});
