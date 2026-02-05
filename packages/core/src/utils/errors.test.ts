/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { toFriendlyError } from './errors.js';

const makeGaxiosError = (data: unknown) => ({
  response: { data },
});

describe('toFriendlyError', () => {
  it('returns original error when response data is not valid JSON', () => {
    const input = makeGaxiosError('');

    expect(toFriendlyError(input)).toBe(input);
  });

  it('returns original error when response data is non-JSON string', () => {
    const input = makeGaxiosError('Service unavailable');

    expect(toFriendlyError(input)).toBe(input);
  });

  it('maps JSON error response into friendly error', () => {
    const input = makeGaxiosError(
      JSON.stringify({
        error: {
          code: 401,
          message: 'unauthorized',
        },
      }),
    );

    const result = toFriendlyError(input);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('unauthorized');
  });
});
