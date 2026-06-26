/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { firstNonEmptyString } from './coalesce.js';

describe('firstNonEmptyString', () => {
  it('returns the first non-empty string', () => {
    expect(firstNonEmptyString('a', 'b')).toBe('a');
  });

  it('treats an empty string as absent and falls through', () => {
    expect(firstNonEmptyString('', 'b')).toBe('b');
  });

  it('skips null and undefined candidates', () => {
    expect(firstNonEmptyString(undefined, null, 'c')).toBe('c');
  });

  it('falls through multiple empty/nullish values to the final fallback', () => {
    expect(firstNonEmptyString('', undefined, null, 'last')).toBe('last');
  });

  it('returns undefined when every candidate is empty or nullish', () => {
    expect(firstNonEmptyString('', undefined, null)).toBeUndefined();
  });

  it('preserves "a || b" semantics for whitespace-only strings (truthy)', () => {
    expect(firstNonEmptyString(' ', 'b')).toBe(' ');
  });
});
