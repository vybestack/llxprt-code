/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3909: Turn converts a thrown error into the StructuredError carried by
 * the stream error event. The conversion used to keep only the message, so a
 * local tokenization failure became indistinguishable from a provider failure
 * by the time the CLI formatted it.
 */

import { describe, expect, it } from 'bun:test';
import { LocalTokenizationError } from '@vybestack/llxprt-code-core/utils/errors.js';
import { buildStructuredError } from './turnJsonUtils.js';

describe('buildStructuredError local tokenization classification (issue #3909)', () => {
  it('classifies a local tokenization error and keeps its message', () => {
    const error = new LocalTokenizationError('local counter failed');

    expect(buildStructuredError(error)).toStrictEqual({
      message: 'local counter failed',
      category: 'local_tokenization',
    });
  });

  it('keeps the message of a failure that carries its own cause detail', () => {
    const error = new LocalTokenizationError(
      'Prompt estimator tokenization-failed for claude-opus-5; cause: encode exploded',
      { cause: new Error('encode exploded') },
    );

    const structured = buildStructuredError(error);

    expect(structured.category).toBe('local_tokenization');
    expect(structured.message).toContain('claude-opus-5');
    expect(structured.message).toContain('encode exploded');
  });

  it('leaves provider failures with their own status and category', () => {
    const providerFailure = Object.assign(new Error('rate limited'), {
      status: 429,
      category: 'rate_limit',
    });

    expect(buildStructuredError(providerFailure)).toStrictEqual({
      message: 'rate limited',
      status: 429,
      category: 'rate_limit',
    });
  });

  it('does not classify an ordinary error', () => {
    expect(buildStructuredError(new Error('boom'))).toStrictEqual({
      message: 'boom',
    });
  });
});
