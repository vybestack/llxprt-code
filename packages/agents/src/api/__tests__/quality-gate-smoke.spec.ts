/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P08
 * @requirement:REQ-019
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { classifyString } from '../quality-gate-smoke.js';

describe('classifyString', () => {
  it('returns "empty" for the empty string', () => {
    expect(classifyString('')).toBe('empty');
  });

  it('returns "non-empty" for a non-empty string', () => {
    expect(classifyString('x')).toBe('non-empty');
  });

  it('returns "non-empty" for any arbitrary non-empty string (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (str) => {
        expect(classifyString(str)).toBe('non-empty');
      }),
    );
  });
});
