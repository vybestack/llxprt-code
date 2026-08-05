/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3037 — tool errors must deliver the model-facing llmContent remedy.
 * These are the unit-level proofs for the extraction helper and the
 * createErrorResponse boundary (T1 in the accepted plan). They assert the
 * observable ToolCallResponseInfo / extracted text, never method bookkeeping.
 */

import { describe, it, expect } from 'bun:test';
import {
  createErrorResponse,
  extractModelFacingErrorText,
} from './generateContentResponseUtilities.js';
import type { ToolCallRequestInfo } from '../core/turn.js';
import type { ToolErrorType } from '../index.js';
import type { ToolOutputSettingsProvider } from './toolOutputLimiter.js';
import type { ContentBlock } from '../services/history/IContent.js';

function makeRequest(
  callId = 'call-err',
  name = 'failingTool',
): ToolCallRequestInfo {
  return {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: 'prompt-1',
  };
}

/**
 * Narrows a tool_response ContentBlock and reads its `result.error` string
 * via real type guards (not a cast), failing the test with a clear message if
 * the block shape does not match expectations.
 */
function toolResponseErrorText(block: ContentBlock): string {
  if (block.type !== 'tool_response') {
    throw new Error(
      `expected a tool_response block but got ${String(block.type)}`,
    );
  }
  const result = block.result;
  if (typeof result !== 'object' || result === null || !('error' in result)) {
    throw new Error(
      'tool_response block result is not an object with an error property',
    );
  }
  if (typeof result.error !== 'string') {
    throw new Error('tool_response block result.error is not a string');
  }
  return result.error;
}

const REMEDY =
  'Cannot insert at line 999: exceeds file length (8). Use line_number <= 9 to append.';
const TERSE = 'line_number 999 exceeds file length (8)';

describe('createErrorResponse — model-facing content (issue #3037)', () => {
  it('falls back to error.message when no fourth argument is given (AC5)', () => {
    const error = new Error(TERSE);
    const response = createErrorResponse(
      makeRequest(),
      error,
      'EXECUTION_FAILED' as ToolErrorType,
    );

    const block = response.responseParts[0];
    expect(toolResponseErrorText(block)).toBe(TERSE);
  });

  it('delivers model-facing content in result.error while keeping resultDisplay and error.message terse (AC1 + AC2)', () => {
    const error = new Error(TERSE);
    const response = createErrorResponse(
      makeRequest(),
      error,
      'INVALID_TOOL_PARAMS' as ToolErrorType,
      REMEDY,
    );

    expect(response.error).toBe(error);
    expect(response.error?.message).toBe(TERSE);
    expect(response.resultDisplay).toBe(TERSE);
    expect(response.errorType).toBe('INVALID_TOOL_PARAMS');

    const block = response.responseParts[0];
    expect(toolResponseErrorText(block)).toBe(REMEDY);
  });

  it('falls back to error.message when modelFacingContent is undefined', () => {
    const error = new Error(TERSE);
    const response = createErrorResponse(
      makeRequest(),
      error,
      undefined,
      undefined,
    );
    expect(toolResponseErrorText(response.responseParts[0])).toBe(TERSE);
  });
});

describe('extractModelFacingErrorText (issue #3037)', () => {
  it('returns a non-empty remedial string verbatim', () => {
    expect(extractModelFacingErrorText(REMEDY, 'insert_at_line')).toBe(REMEDY);
  });

  it.each(['', '   ', '   \n\t  '])(
    'returns undefined for whitespace-only string %j (falls back to error.message)',
    (value) => {
      expect(
        extractModelFacingErrorText(value, 'insert_at_line'),
      ).toBeUndefined();
    },
  );

  it('returns undefined for undefined and null', () => {
    expect(
      extractModelFacingErrorText(undefined, 'insert_at_line'),
    ).toBeUndefined();
    expect(extractModelFacingErrorText(null, 'insert_at_line')).toBeUndefined();
  });

  it('joins legacy {text} parts with newlines', () => {
    expect(
      extractModelFacingErrorText([{ text: 'a' }, { text: 'b' }], 'tool'),
    ).toBe('a\nb');
  });

  it('joins a plain string[] with newlines', () => {
    expect(extractModelFacingErrorText(['a', 'b'], 'tool')).toBe('a\nb');
  });

  it('returns undefined when only inlineData (media) parts are present', () => {
    expect(
      extractModelFacingErrorText(
        [{ inlineData: { data: 'YWJj', mimeType: 'text/plain' } }],
        'tool',
      ),
    ).toBeUndefined();
  });

  it('returns undefined when text parts are all whitespace', () => {
    expect(
      extractModelFacingErrorText([{ text: '   ' }, { text: '\n' }], 'tool'),
    ).toBeUndefined();
  });

  it('applies the token limit just like the success path (AC4)', () => {
    const oversized = Array.from(
      { length: 200 },
      (_, index) => `word${index}`,
    ).join(' ');
    const lowConfig: ToolOutputSettingsProvider = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 50,
        'tool-output-truncate-mode': 'truncate',
      }),
    };

    const result = extractModelFacingErrorText(
      oversized,
      'read_file',
      lowConfig,
    );

    expect(result).toBeDefined();
    expect(result!.length).toBeLessThan(oversized.length);
    expect(result).toContain('[Output truncated due to token limit]');
  });

  // Ordering guard: the blank check must run BEFORE limitStringOutput. When
  // the limiter truncates, it appends a non-blank marker, so limiting first
  // would turn whitespace-only content into a spurious "truncated" string and
  // suppress the error.message fallback required by AC3.
  it('keeps the blank check ahead of truncation for an oversized whitespace-only string (AC3)', () => {
    const lowConfig: ToolOutputSettingsProvider = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 5,
        'tool-output-truncate-mode': 'truncate',
      }),
    };
    expect(
      extractModelFacingErrorText(' '.repeat(1000), 'read_file', lowConfig),
    ).toBeUndefined();
  });

  it('keeps the blank check ahead of truncation for an oversized whitespace-only text-part array (AC3)', () => {
    const lowConfig: ToolOutputSettingsProvider = {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': 5,
        'tool-output-truncate-mode': 'truncate',
      }),
    };
    expect(
      extractModelFacingErrorText(
        [{ text: ' '.repeat(1000) }],
        'read_file',
        lowConfig,
      ),
    ).toBeUndefined();
  });
});
