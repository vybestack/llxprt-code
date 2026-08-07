/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { formatConfigFileErrors } from './configError.js';

describe('formatConfigFileErrors', () => {
  it('formats an empty error list without a leading blank line', () => {
    expect(formatConfigFileErrors([])).toBe(
      'Please fix the configuration file(s) and try again.',
    );
  });
});
