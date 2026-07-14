/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseModelParamValue } from './modelParamParser.js';

describe('parseModelParamValue', () => {
  it('parses finite numeric strings as numbers', () => {
    expect(parseModelParamValue('42')).toBe(42);
    expect(parseModelParamValue(' 3.14 ')).toBe(3.14);
  });

  it('leaves non-finite numeric strings as raw strings', () => {
    expect(parseModelParamValue('Infinity')).toBe('Infinity');
    expect(parseModelParamValue('-Infinity')).toBe('-Infinity');
  });
});
