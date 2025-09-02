/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { findIndexAfterFraction } from '../client.js';
import { COMPRESSION_PRESERVE_THRESHOLD } from '../compression-config.js';

describe('Compression logic tests', () => {
  it('should calculate preservation index correctly', () => {
    // This test verifies that findIndexAfterFraction properly distributes
    // messages between compressed and preserved portions based on character length

    const mockHistory = [
      { role: 'user', parts: [{ text: 'Short message 1' }] },
      { role: 'model', parts: [{ text: 'Short response 1' }] },
      {
        role: 'user',
        parts: [
          {
            text: 'This is a significantly longer user message that contains much more content to test the calculation logic properly.',
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'This is an even longer model response with extremely detailed information to ensure we are properly measuring the character lengths in our compression calculations.',
          },
        ],
      },
      { role: 'user', parts: [{ text: 'Short message 2' }] },
    ];

    // With COMPRESSION_PRESERVE_THRESHOLD = 0.5, we should preserve 50% of the conversation
    const preserveFraction = COMPRESSION_PRESERVE_THRESHOLD;
    const compressBeforeIndex = findIndexAfterFraction(
      mockHistory,
      1 - preserveFraction,
    );

    // The preserved portion should be at least 2 items given the distribution of characters
    expect(compressBeforeIndex).toBeLessThan(mockHistory.length);
    expect(mockHistory.length - compressBeforeIndex).toBeGreaterThanOrEqual(2);
  });
});
