/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3063 — compression must keep BOTH channels of a failed tool call.
 * A failed tool_response carries the terse top-level `error` marker AND the
 * model-facing remedy in `result`. Before this fix the sanitizer rendered the
 * two channels as mutually exclusive (else-if), so compression discarded the
 * #3037 remedy once the marker existed. This feeds OneShotStrategy and
 * MiddleOutStrategy. The test asserts on the sanitized text output (AC14).
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sanitizeHistoryForCompression } from './utils.js';

const REMEDY = 'File not found; check the path and try read_file again.';
const TERSE = 'file_not_found: /missing/path';

function toolResponseMsg(result: unknown, error?: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'c1',
        toolName: 'read_file',
        result,
        ...(error !== undefined ? { error } : {}),
      },
    ],
  };
}

function sanitizedText(msg: IContent): string {
  const block = sanitizeHistoryForCompression([msg])[0].blocks[0];
  if (block.type !== 'text') {
    throw new Error(
      `expected a sanitized text block but got ${String(block.type)}`,
    );
  }
  return block.text;
}

describe('sanitizeHistoryForCompression — tool failure fidelity (issue #3063)', () => {
  it('renders BOTH the terse marker and the model-facing remedy for a failed block (AC14)', () => {
    const text = sanitizedText(toolResponseMsg({ error: REMEDY }, TERSE));

    expect(text).toContain('[Tool Result: read_file]');
    // The terse top-level marker is preserved.
    expect(text).toContain(`Error: ${TERSE}`);
    // The model-facing remedy is ALSO preserved (no longer discarded by an
    // else-if that made the channels mutually exclusive).
    expect(text).toContain(`Result: ${JSON.stringify({ error: REMEDY })}`);
    expect(text).toContain(REMEDY);
  });

  it('still renders only the result for a success block with no marker', () => {
    const text = sanitizedText(toolResponseMsg({ output: 'done' }));

    expect(text).not.toContain('Error:');
    expect(text).toContain('Result:');
    expect(text).toContain('done');
  });

  it('still renders the marker-only channel when there is no result payload', () => {
    const text = sanitizedText(
      toolResponseMsg(undefined, 'Tool call interrupted or cancelled'),
    );

    expect(text).toContain('Error: Tool call interrupted or cancelled');
    // No result payload line is appended when result is undefined. (The header
    // "[Tool Result: ...]" still contains the word "Result", so check for the
    // payload line marker rather than the bare substring.)
    expect(text).not.toContain(`
Result:`);
  });
});
