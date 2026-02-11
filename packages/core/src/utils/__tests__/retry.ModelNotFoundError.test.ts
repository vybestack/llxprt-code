/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ModelNotFoundError } from '../retry.js';

describe('ModelNotFoundError', () => {
  it('is an instance of Error', () => {
    const err = new ModelNotFoundError('model not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name ModelNotFoundError', () => {
    const err = new ModelNotFoundError('model not found');
    expect(err.name).toBe('ModelNotFoundError');
  });

  it('defaults code to 404', () => {
    const err = new ModelNotFoundError('model not found');
    expect(err.code).toBe(404);
  });

  it('accepts a custom code', () => {
    const err = new ModelNotFoundError('gone', 410);
    expect(err.code).toBe(410);
  });

  it('preserves the message', () => {
    const err = new ModelNotFoundError('gemini-99 not found');
    expect(err.message).toBe('gemini-99 not found');
  });
});
