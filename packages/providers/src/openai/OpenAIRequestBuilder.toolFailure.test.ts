/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — a failed tool call must render to OpenAI-family text with a
 * `status: error` section, a non-empty `error:` section (the terse marker), AND
 * the model-facing remedy in the `output:` section. The failure block is built
 * by the REAL createErrorResponse (not hand-crafted) so the producer and
 * consumer halves cannot drift apart.
 */

import { describe, it, expect } from 'bun:test';
import type { ToolResponseBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolCallRequestInfo } from '@vybestack/llxprt-code-core/core/turn.js';
import { createErrorResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { buildToolResponseContent } from './OpenAIRequestBuilder.js';

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

describe('OpenAIRequestBuilder — tool failure rendering (issue #3063)', () => {
  it('renders status "error", a non-empty error section, AND the remedy in the output section (AC7)', () => {
    const rendered = buildToolResponseContent(failureBlock());

    expect(rendered).toContain('status:\nerror');
    expect(rendered).toContain(`error:\n${TERSE}`);
    // The model-facing remedy appears in the rendered output: section, not only
    // the terse marker (the two channels are kept separate).
    expect(rendered).toContain('output:');
    expect(rendered).toContain(REMEDY);
  });
});
