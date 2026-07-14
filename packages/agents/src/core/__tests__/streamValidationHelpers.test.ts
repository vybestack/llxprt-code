/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for validateStreamCompletion through the active validation
 * path. Tests the error-classification accuracy for canonical 'error'
 * finishReason, which maps from multiple raw stop reasons
 * (MALFORMED_FUNCTION_CALL, UNEXPECTED_TOOL_CALL).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 */

import { describe, it, expect } from 'vitest';
import { validateStreamCompletion } from '../streamValidationHelpers.js';
import { InvalidStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';

function makeLogger(): DebugLogger {
  return new DebugLogger('test-stream-validation');
}

function makeUserInput(): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] };
}

/** Outcome with some content so the "empty response" branches don't fire. */
function makeOutcomeWithText(): ResponseOutcome {
  return {
    hasVisibleText: true,
    hasThinking: false,
    hasToolCalls: false,
    isActionable: true,
  };
}

describe('validateStreamCompletion — canonical error classification', () => {
  it('throws MALFORMED_FUNCTION_CALL when rawStopReason is MALFORMED_FUNCTION_CALL', () => {
    expect(() =>
      validateStreamCompletion(
        makeLogger(),
        makeUserInput(),
        makeOutcomeWithText(),
        'error',
        'some text',
        'MALFORMED_FUNCTION_CALL',
      ),
    ).toThrow(
      expect.objectContaining({
        type: 'MALFORMED_FUNCTION_CALL',
      }) as unknown as Error,
    );
  });

  it('does NOT throw MALFORMED_FUNCTION_CALL when rawStopReason is UNEXPECTED_TOOL_CALL', () => {
    // UNEXPECTED_TOOL_CALL also canonicalizes to 'error' but is NOT malformed.
    // The function should NOT throw MALFORMED_FUNCTION_CALL.
    let threw: InvalidStreamError | undefined;
    try {
      validateStreamCompletion(
        makeLogger(),
        makeUserInput(),
        makeOutcomeWithText(),
        'error',
        'some text',
        'UNEXPECTED_TOOL_CALL',
      );
    } catch (e) {
      if (e instanceof InvalidStreamError) threw = e;
    }
    expect(threw?.type).not.toBe('MALFORMED_FUNCTION_CALL');
  });

  it('does NOT throw MALFORMED_FUNCTION_CALL for an unknown error reason', () => {
    let threw: InvalidStreamError | undefined;
    try {
      validateStreamCompletion(
        makeLogger(),
        makeUserInput(),
        makeOutcomeWithText(),
        'error',
        'some text',
        'SOME_NEW_ERROR_REASON',
      );
    } catch (e) {
      if (e instanceof InvalidStreamError) threw = e;
    }
    expect(threw?.type).not.toBe('MALFORMED_FUNCTION_CALL');
  });

  it('throws MALFORMED_FUNCTION_CALL when rawStopReason is undefined but finishReason is error (backward compat)', () => {
    // When rawStopReason is not available, the canonical 'error' should still
    // be treated as malformed for backward compatibility.
    expect(() =>
      validateStreamCompletion(
        makeLogger(),
        makeUserInput(),
        makeOutcomeWithText(),
        'error',
        'some text',
        undefined,
      ),
    ).toThrow(
      expect.objectContaining({
        type: 'MALFORMED_FUNCTION_CALL',
      }) as unknown as Error,
    );
  });

  it('does NOT throw for non-error finishReason with text content', () => {
    expect(() =>
      validateStreamCompletion(
        makeLogger(),
        makeUserInput(),
        makeOutcomeWithText(),
        'stop',
        'response text',
        'STOP',
      ),
    ).not.toThrow();
  });
});
