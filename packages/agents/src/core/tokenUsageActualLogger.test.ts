/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { recordActualTokenUsage } from './tokenUsageActualLogger.js';

describe('recordActualTokenUsage', () => {
  it('keeps logging failures from rejecting the successful turn', async () => {
    const recordActual = vi.fn().mockRejectedValue(new Error('write failed'));

    await expect(
      recordActualTokenUsage(
        { isEnabled: () => true, recordActual },
        'prompt-1',
        { promptTokenCount: 100, cachedContentTokenCount: 25 },
      ),
    ).resolves.toBeUndefined();
    expect(recordActual).toHaveBeenCalledExactlyOnceWith('prompt-1', {
      actualPromptTokens: 100,
      cachedTokens: 25,
    });
  });
});
