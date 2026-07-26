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

  it('records successful actual usage once', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-2',
      { promptTokenCount: 50, cache_read_input_tokens: 10 },
    );

    expect(recordActual).toHaveBeenCalledExactlyOnceWith('prompt-2', {
      actualPromptTokens: 50,
      cachedTokens: 10,
    });
  });

  it('skips disabled, missing, and throwing logger guards', async () => {
    const recordActual = vi.fn();

    await recordActualTokenUsage(
      { isEnabled: () => false, recordActual },
      'prompt-disabled',
      { promptTokenCount: 10 },
    );
    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-missing',
      {},
    );
    await expect(
      recordActualTokenUsage(
        {
          isEnabled: () => {
            throw new Error('guard failed');
          },
          recordActual,
        },
        'prompt-throwing',
        { promptTokenCount: 10 },
      ),
    ).resolves.toBeUndefined();

    expect(recordActual).not.toHaveBeenCalled();
  });
});
