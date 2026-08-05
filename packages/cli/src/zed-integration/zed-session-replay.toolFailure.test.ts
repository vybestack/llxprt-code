/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — Zed replay must still show the model-facing text for a failed
 * tool call. Once createErrorResponse sets the top-level `error` marker, a
 * failed block carries the terse marker in `error` AND the remedy in
 * `result.error`. Replay must classify the call as `failed` (honouring either
 * field) but DISPLAY the model-facing remedy, falling back to the marker only
 * when `result` carries no usable text. These tests drive the real
 * mapHistoryToSessionUpdates and assert on the emitted ACP tool_call_update
 * (status AND content) (AC16).
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import { mapHistoryToSessionUpdates } from './zed-session-replay.js';

const REMEDY = 'File not found; check the path and try read_file again.';
const TERSE = 'file_not_found: /missing/path';

/** Two-turn history: ai tool_call → tool tool_response, so the response pairs. */
function historyWithToolResponse(
  callId: string,
  result: unknown,
  error?: string,
): IContent[] {
  return [
    {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: callId, name: 'read_file', parameters: {} },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId,
          toolName: 'read_file',
          result,
          ...(error !== undefined ? { error } : {}),
        },
      ],
    },
  ];
}

describe('Zed session replay — tool failure fidelity (issue #3063)', () => {
  it('classifies a failed call as failed AND displays the model-facing remedy, not the terse marker (AC16)', () => {
    const updates = mapHistoryToSessionUpdates(
      historyWithToolResponse('call-fail', { error: REMEDY }, TERSE),
    );

    // The terminal update is failed and carries the remedy, not the marker.
    expect(updates[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-fail',
      status: 'failed',
      kind: 'read',
      content: [{ type: 'content', content: { type: 'text', text: REMEDY } }],
    });
  });

  it('falls back to the top-level marker only when result carries no usable text (AC16)', () => {
    // result has no error/output text; only the top-level marker is present.
    const updates = mapHistoryToSessionUpdates(
      historyWithToolResponse('call-marker', undefined, TERSE),
    );

    expect(updates[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-marker',
      status: 'failed',
      kind: 'read',
      content: [{ type: 'content', content: { type: 'text', text: TERSE } }],
    });
  });

  it('classifies a failed call as failed when only result carries the error (no top-level marker)', () => {
    // result.error present, top-level marker absent: still failed.
    const updates = mapHistoryToSessionUpdates(
      historyWithToolResponse('call-result-only', { error: REMEDY }),
    );

    expect(updates[1]).toStrictEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-result-only',
      status: 'failed',
      kind: 'read',
      content: [{ type: 'content', content: { type: 'text', text: REMEDY } }],
    });
  });
});
