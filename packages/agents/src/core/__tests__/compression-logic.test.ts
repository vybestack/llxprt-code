/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { findCompressSplitPoint } from '../client.js';
import { COMPRESSION_PRESERVE_THRESHOLD } from '../compression-config.js';

describe('Compression Logic', () => {
  it('should calculate preservation index with new threshold', () => {
    const mockHistory = [
      { role: 'user', parts: [{ text: 'Short message' }] },
      { role: 'model', parts: [{ text: 'Short response' }] },
      {
        role: 'user',
        parts: [
          {
            text: 'This is a longer user message that contains more content to test the calculation logic properly.',
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
      { role: 'user', parts: [{ text: 'Another short message' }] },
    ];

    // With the new COMPRESSION_PRESERVE_THRESHOLD (0.5), we expect different behavior
    const preservedFraction = COMPRESSION_PRESERVE_THRESHOLD; // 0.5
    const compressBeforeIndex = findCompressSplitPoint(
      mockHistory,
      1 - preservedFraction,
    );

    // Since we're preserving 50% by character count, the index should be somewhere in the middle
    expect(compressBeforeIndex).toBeGreaterThan(0);
    expect(compressBeforeIndex).toBeLessThanOrEqual(mockHistory.length);
  });
});
