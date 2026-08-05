/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — a failed tool call must reach Gemini as a functionResponse
 * whose response.status is "error" and whose response.error carries the terse
 * marker, while response.result still carries the model-facing remedy. The
 * failure block is built by the REAL createErrorResponse (not hand-crafted) so
 * the producer and consumer halves cannot drift apart.
 */

import { describe, it, expect } from 'bun:test';
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import { createErrorResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { convertHistoryToGeminiFormat } from './GeminiMessageConverter.js';

const REMEDY = 'File not found; check the path and try read_file again.';
const TERSE = 'file_not_found: /missing/path';

/**
 * Returns the `response` object of the first functionResponse part emitted by
 * the real converter, throwing loudly when the history produced none.
 */
function functionResponsePayload(
  contents: ReturnType<typeof convertHistoryToGeminiFormat>,
): Record<string, unknown> {
  for (const content of contents) {
    for (const part of content.parts) {
      const response = part.functionResponse?.response;
      if (response !== undefined) {
        return response;
      }
    }
  }
  throw new Error('no functionResponse part was emitted');
}

function toolContent(block: ToolResponseBlock): IContent {
  return { speaker: 'tool', blocks: [block] };
}

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

describe('GeminiMessageConverter — tool failure fidelity (issue #3063)', () => {
  it('reports status "error" and the terse marker while keeping the remedy in result for a producer-built block (AC6)', () => {
    const response = functionResponsePayload(
      convertHistoryToGeminiFormat([toolContent(failureBlock())]),
    );

    expect(response['status']).toBe('error');
    expect(response['error']).toBe(TERSE);
    // The model-facing remedy still travels in result (JSON-serialized).
    expect(String(response['result'])).toContain(REMEDY);
  });

  it('reports status "success" with no error for a successful tool call (AC8)', () => {
    const successBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call-ok',
      toolName: 'okTool',
      result: { output: 'all good' },
    };

    const response = functionResponsePayload(
      convertHistoryToGeminiFormat([toolContent(successBlock)]),
    );

    expect(response['status']).toBe('success');
    expect(response['error']).toBeUndefined();
  });
});
