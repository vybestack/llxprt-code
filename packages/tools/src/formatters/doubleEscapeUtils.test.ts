/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { processToolParameters } from './doubleEscapeUtils.js';

describe('processToolParameters', () => {
  it('converts only decimal-shaped string numbers from double-escaped parameters', () => {
    const params = {
      integer: '123',
      decimal: '.5',
      exponent: '3.14E-10',
      incompleteExponent: '1e',
      signedIncompleteExponent: '1e+',
      hex: '0xff',
      padded: '  12 ',
    };
    const doubleEscaped = JSON.stringify(JSON.stringify(params));

    expect(processToolParameters(doubleEscaped, 'test-tool')).toEqual({
      integer: 123,
      decimal: 0.5,
      exponent: 3.14e-10,
      incompleteExponent: '1e',
      signedIncompleteExponent: '1e+',
      hex: '0xff',
      padded: '  12 ',
    });
  });
});
