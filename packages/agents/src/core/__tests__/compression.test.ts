/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { findCompressSplitPoint } from '../client.js';
import { COMPRESSION_PRESERVE_THRESHOLD } from '../compression-config.js';

describe('Compression logic tests', () => {
  it('should calculate preservation index correctly', () => {
    // This test verifies that findIndexAfterFraction properly distributes
    // messages between compressed and preserved portions based on character length

    const mockHistory: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Short message 1' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Short response 1' }] },
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'This is a significantly longer user message that contains much more content to test the calculation logic properly.',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'This is an even longer model response with extremely detailed information to ensure we are properly measuring the character lengths in our compression calculations.',
          },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'Short message 2' }] },
    ];

    // With COMPRESSION_PRESERVE_THRESHOLD = 0.5, we should preserve 50% of the conversation
    const preserveFraction = COMPRESSION_PRESERVE_THRESHOLD;
    const compressBeforeIndex = findCompressSplitPoint(
      mockHistory,
      1 - preserveFraction,
    );

    // The split point should be within valid bounds based on character distribution
    expect(compressBeforeIndex).toBeGreaterThan(0);
    expect(compressBeforeIndex).toBeLessThanOrEqual(mockHistory.length);
  });
});
