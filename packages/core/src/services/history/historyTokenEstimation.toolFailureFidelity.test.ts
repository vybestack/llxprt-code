/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — token estimation must count what is actually transmitted. A
 * failed tool_response carries BOTH the terse top-level `error` marker AND the
 * model-facing remedy in `result`. Before this fix, stringifyToolResponseForTokens
 * returned the marker and skipped the object result, undercounting the wire
 * payload. These tests drive the real HistoryService estimator with a real
 * tokenizer and assert on the observable token count (AC15).
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent, ToolResponseBlock } from './IContent.js';

const REMEDY =
  'Cannot insert at line 999: exceeds file length (8). Use line_number <= 9 to append.';
const TERSE = 'line_number 999 exceeds file length (8)';

function toolResponseContent(block: ToolResponseBlock): IContent {
  return { speaker: 'tool', blocks: [block] };
}

function makeService(): HistoryService {
  const svc = new HistoryService();
  svc.setActiveTokenizationTarget('claude-sonnet-4-20250514', 'anthropic');
  return svc;
}

describe('estimateTokensForContents — tool failure fidelity (issue #3063)', () => {
  it('does not shrink the estimate when a marker is added to a block that already carried a payload (AC15)', async () => {
    const svc = makeService();

    const payloadOnly = toolResponseContent({
      type: 'tool_response',
      callId: 'c-payload',
      toolName: 'edit',
      result: { error: REMEDY },
    });
    const payloadAndMarker = toolResponseContent({
      type: 'tool_response',
      callId: 'c-both',
      toolName: 'edit',
      result: { error: REMEDY },
      error: TERSE,
    });

    const tokensPayloadOnly = await svc.estimateTokensForContents([
      payloadOnly,
    ]);
    const tokensBoth = await svc.estimateTokensForContents([payloadAndMarker]);

    // Adding the marker must not shrink the estimate: both channels are
    // transmitted, so the combined count must exceed the payload-only count.
    expect(tokensBoth).toBeGreaterThan(tokensPayloadOnly);
  });

  it('counts both the marker and the object result, not just the marker (AC15)', async () => {
    const svc = makeService();

    const markerOnly = toolResponseContent({
      type: 'tool_response',
      callId: 'c-marker',
      toolName: 'edit',
      result: undefined,
      error: TERSE,
    });
    const payloadAndMarker = toolResponseContent({
      type: 'tool_response',
      callId: 'c-both',
      toolName: 'edit',
      result: { error: REMEDY },
      error: TERSE,
    });

    const tokensMarkerOnly = await svc.estimateTokensForContents([markerOnly]);
    const tokensBoth = await svc.estimateTokensForContents([payloadAndMarker]);

    // A block carrying both channels must estimate higher than a marker-only
    // block — the payload is counted, not discarded in favour of the marker.
    expect(tokensBoth).toBeGreaterThan(tokensMarkerOnly);
  });
});
