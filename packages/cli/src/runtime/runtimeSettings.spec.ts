/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { PROFILE_EPHEMERAL_KEYS } from './runtimeSettings.js';

/**
 * Test suite for Issue #1049: Fix timeout settings for autocomplete, profiles, and defaults
 *
 * These unit tests verify that timeout settings are properly included in profile snapshots.
 *
 * @see https://github.com/vybestack/llxprt-code/issues/1049
 */
describe('PROFILE_EPHEMERAL_KEYS - Timeout Settings (Issue #1049)', () => {
  /**
   * This test verifies that the PROFILE_EPHEMERAL_KEYS constant includes
   * the timeout settings so they are saved to and loaded from profiles.
   */
  it('should include timeout settings in PROFILE_EPHEMERAL_KEYS', () => {
    const timeoutKeys = [
      'task-default-timeout-seconds',
      'task-max-timeout-seconds',
      'shell-default-timeout-seconds',
      'shell-max-timeout-seconds',
    ];

    for (const key of timeoutKeys) {
      expect(
        PROFILE_EPHEMERAL_KEYS,
        `${key} should be in PROFILE_EPHEMERAL_KEYS`,
      ).toContain(key);
    }
  });
});
