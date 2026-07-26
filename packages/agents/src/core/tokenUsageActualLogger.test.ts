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
        { promptTokens: 100, cachedTokens: 25 },
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
      { promptTokens: 50, cache_read_input_tokens: 10 },
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
      { promptTokens: 10 },
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
        { promptTokens: 10 },
      ),
    ).resolves.toBeUndefined();

    expect(recordActual).not.toHaveBeenCalled();
  });

  it('prefers cachedTokens over cache_read_input_tokens when both are present', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-prec',
      { promptTokens: 200, cachedTokens: 30, cache_read_input_tokens: 99 },
    );

    expect(recordActual).toHaveBeenCalledExactlyOnceWith('prompt-prec', {
      actualPromptTokens: 200,
      cachedTokens: 30,
    });
  });

  it('falls back to cache_read_input_tokens when cachedTokens is absent', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-fb',
      { promptTokens: 200, cache_read_input_tokens: 88 },
    );

    expect(recordActual).toHaveBeenCalledExactlyOnceWith('prompt-fb', {
      actualPromptTokens: 200,
      cachedTokens: 88,
    });
  });

  it('records zero cached tokens when neither cache field is present', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-nocache',
      { promptTokens: 5 },
    );

    expect(recordActual).toHaveBeenCalledExactlyOnceWith('prompt-nocache', {
      actualPromptTokens: 5,
      cachedTokens: 0,
    });
  });
});
