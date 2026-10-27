/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3909: a failure of LLxprt's own token counting reached the display as
 * "[API Error: ...]", which sends users looking at their provider. Local
 * tokenization failures are classified separately wherever the display
 * formatter receives them: as the thrown error, or as the structured error
 * carried by a stream error event.
 */

import { describe, expect, it } from 'bun:test';
import { parseAndFormatApiError } from './errorParsing.js';
import { LocalTokenizationError } from './errors.js';
import type { StructuredError } from '../core/turn.js';

const DETAIL =
  'Prompt estimator tokenization-failed for claude-opus-5 (anthropic-messages); verify the history entry; cause: encode exploded';

describe('local tokenization failures at the display boundary (issue #3909)', () => {
  it('labels a thrown local tokenization error as a local failure, not an API error', () => {
    const formatted = parseAndFormatApiError(
      new LocalTokenizationError(DETAIL),
    );

    expect(formatted).toContain(DETAIL);
    expect(formatted).toContain('Local Tokenization Error');
    expect(formatted).not.toContain('API Error');
  });

  it('labels a structured stream error with the local tokenization category the same way', () => {
    const structured: StructuredError = {
      message: DETAIL,
      category: 'local_tokenization',
    };

    const formatted = parseAndFormatApiError(structured);

    expect(formatted).toContain(DETAIL);
    expect(formatted).toContain('Local Tokenization Error');
    expect(formatted).not.toContain('API Error');
  });

  it('says the failure came from local token counting rather than the provider', () => {
    const formatted = parseAndFormatApiError(
      new LocalTokenizationError(DETAIL),
    );

    expect(formatted).toContain('not a response from the provider API');
  });

  it('keeps subclasses of the local tokenization error in the local category', () => {
    class EstimatorFailure extends LocalTokenizationError {}

    expect(parseAndFormatApiError(new EstimatorFailure(DETAIL))).toContain(
      'Local Tokenization Error',
    );
  });

  it('still labels a provider failure as an API error', () => {
    const providerFailure: StructuredError = {
      message: 'Upstream overloaded',
      status: 529,
      category: 'server_error',
    };

    expect(parseAndFormatApiError(providerFailure)).toBe(
      '[API Error: Upstream overloaded (Status: 529)]',
    );
  });

  it('still labels an unclassified thrown error string as an API error', () => {
    expect(parseAndFormatApiError('connection reset')).toBe(
      '[API Error: connection reset]',
    );
  });
});
