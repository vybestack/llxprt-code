/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { classifyGoogleError } from '../googleQuotaErrors.js';
import { ModelNotFoundError } from '../retry.js';

describe('classifyGoogleError 404 handling', () => {
  it('returns ModelNotFoundError for a 404 status error', () => {
    const error = Object.assign(new Error('model not found'), { status: 404 });
    const result = classifyGoogleError(error);
    expect(result).toBeInstanceOf(ModelNotFoundError);
    expect((result as ModelNotFoundError).message).toBe('model not found');
  });

  it('returns ModelNotFoundError for error with response.status 404', () => {
    // Test error with nested response.status (axios-style error)
    const error = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    const result = classifyGoogleError(error);
    expect(result).toBeInstanceOf(ModelNotFoundError);
  });

  it('does not return ModelNotFoundError for a 429 error', () => {
    const error = Object.assign(new Error('rate limit'), { status: 429 });
    const result = classifyGoogleError(error);
    expect(result).not.toBeInstanceOf(ModelNotFoundError);
  });

  it('returns original error for non-HTTP errors', () => {
    const error = new Error('generic error');
    const result = classifyGoogleError(error);
    expect(result).toBe(error);
  });
});
