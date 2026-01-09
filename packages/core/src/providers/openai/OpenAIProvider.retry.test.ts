/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20250109issue1007
 * Issue #1007: Request timeouts should trigger retry like 429
 */

import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';

describe('OpenAIProvider - shouldRetryResponse (Issue #1007)', () => {
  it('retries on 429 rate limit errors', () => {
    const provider = new OpenAIProvider('test-key');
    const error = new Error('Rate limit exceeded');
    (error as { status: number }).status = 429;
    expect(provider.shouldRetryResponse(error)).toBe(true);
  });

  it('retries on network timeout errors', () => {
    const provider = new OpenAIProvider('test-key');
    const error = new Error('Request timeout');
    (error as { code: string }).code = 'ETIMEDOUT';
    expect(provider.shouldRetryResponse(error)).toBe(true);
  });

  it('does not retry on status 200 streaming sentinel', () => {
    const provider = new OpenAIProvider('test-key');
    const error = { status: 200 };
    expect(provider.shouldRetryResponse(error)).toBe(false);
  });
});
