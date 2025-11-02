/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { READ_ONLY_TOOL_NAMES } from '../config.js';

describe('non-interactive approval defaults', () => {
  it('treats ls as a read-only tool', () => {
    expect(
      READ_ONLY_TOOL_NAMES.map((name) => name.trim().toLowerCase()),
    ).toContain('ls');
  });
});
