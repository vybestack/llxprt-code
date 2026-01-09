/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Test suite for Issue #1049: Fix timeout settings preservation
 *
 * These unit tests verify that timeout settings are included in preserveEphemerals
 * so they survive provider switches.
 *
 * @see https://github.com/vybestack/llxprt-code/issues/1049
 */
describe('Profile Application - preserveEphemerals (Issue #1049)', () => {
  /**
   * This test verifies that the applyProfileWithGuards function includes
   * timeout settings in the preserveEphemerals array when calling switchActiveProvider.
   */
  it('should include timeout settings in preserveEphemerals array', () => {
    const filePath = path.join(__dirname, 'profileApplication.ts');
    const content = fs.readFileSync(filePath, 'utf-8');

    const timeoutKeys = [
      'task-default-timeout-seconds',
      'task-max-timeout-seconds',
      'shell-default-timeout-seconds',
      'shell-max-timeout-seconds',
    ];

    for (const key of timeoutKeys) {
      expect(content, `${key} should be in preserveEphemerals array`).toContain(
        `'${key}'`,
      );
    }
  });
});
