/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
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
    expect(recordActual).toHaveBeenCalledTimes(1);
    expect(recordActual).toHaveBeenCalledWith('prompt-1', {
      actualPromptTokens: 100,
      cachedTokens: 25,
      cacheReadTokens: 25,
    });
  });

  it('records successful actual usage once', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-2',
      { promptTokens: 50, cache_read_input_tokens: 10 },
    );

    expect(recordActual).toHaveBeenCalledTimes(1);
    expect(recordActual).toHaveBeenCalledWith('prompt-2', {
      actualPromptTokens: 50,
      cachedTokens: 10,
      cacheReadTokens: 10,
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

    expect(recordActual).toHaveBeenCalledTimes(1);
    expect(recordActual).toHaveBeenCalledWith('prompt-prec', {
      actualPromptTokens: 200,
      cachedTokens: 30,
      cacheReadTokens: 30,
    });
  });

  it('falls back to cache_read_input_tokens when cachedTokens is absent', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-fb',
      { promptTokens: 200, cache_read_input_tokens: 88 },
    );

    expect(recordActual).toHaveBeenCalledTimes(1);
    expect(recordActual).toHaveBeenCalledWith('prompt-fb', {
      actualPromptTokens: 200,
      cachedTokens: 88,
      cacheReadTokens: 88,
    });
  });

  it('records zero cached tokens when neither cache field is present', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-nocache',
      { promptTokens: 5 },
    );

    expect(recordActual).toHaveBeenCalledTimes(1);
    expect(recordActual).toHaveBeenCalledWith('prompt-nocache', {
      actualPromptTokens: 5,
      cachedTokens: 0,
    });
  });

  // ----- AC-3 cost completion: each cost field forwards -----

  it('forwards completionTokens as outputTokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-output',
      { promptTokens: 100, completionTokens: 50 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual).toBeDefined();
    expect(actual.outputTokens).toBe(50);
  });

  it('forwards totalTokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-total',
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.totalTokens).toBe(150);
  });

  it('forwards reasoningTokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-reasoning',
      { promptTokens: 100, reasoningTokens: 7 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.reasoningTokens).toBe(7);
  });

  it('forwards toolTokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-tool',
      { promptTokens: 100, toolTokens: 12 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.toolTokens).toBe(12);
  });

  it('forwards cacheWriteTokens from cacheCreationTokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-cw-creation',
      { promptTokens: 100, cacheCreationTokens: 300 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.cacheWriteTokens).toBe(300);
  });

  it('forwards cacheWriteTokens from cache_creation_input_tokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-cw-snake',
      { promptTokens: 100, cache_creation_input_tokens: 250 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.cacheWriteTokens).toBe(250);
  });

  it('forwards cacheReadTokens from cachedTokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-cr-camel',
      { promptTokens: 100, cachedTokens: 40 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.cacheReadTokens).toBe(40);
  });

  it('forwards cacheReadTokens from cache_read_input_tokens', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-cr-snake',
      { promptTokens: 100, cache_read_input_tokens: 60 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.cacheReadTokens).toBe(60);
  });

  it('forwards all cost fields together (Anthropic-style cache read+write)', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-anthropic',
      {
        promptTokens: 5000,
        completionTokens: 10,
        totalTokens: 5010,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 500,
      },
    );

    expect(recordActual).toHaveBeenCalledWith('prompt-anthropic', {
      actualPromptTokens: 5000,
      cachedTokens: 2000,
      outputTokens: 10,
      totalTokens: 5010,
      cacheReadTokens: 2000,
      cacheWriteTokens: 500,
    });
  });

  // ----- AC-3 cost completion: unreported fields are OMITTED -----

  it('omits cost fields the provider did not report', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-omit-cost',
      { promptTokens: 100 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual).toBeDefined();
    expect('outputTokens' in actual).toBe(false);
    expect('totalTokens' in actual).toBe(false);
    expect('reasoningTokens' in actual).toBe(false);
    expect('toolTokens' in actual).toBe(false);
    expect('cacheReadTokens' in actual).toBe(false);
    expect('cacheWriteTokens' in actual).toBe(false);
  });

  it('preserves legacy cached_tokens=0 and effective_actual_tokens when no cache reported', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-legacy-zero',
      { promptTokens: 200 },
    );

    expect(recordActual).toHaveBeenCalledWith('prompt-legacy-zero', {
      actualPromptTokens: 200,
      cachedTokens: 0,
    });
  });

  it('does not zero-fill cacheWriteTokens when only cacheReadTokens is reported', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-read-only',
      { promptTokens: 100, cachedTokens: 30 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.cacheReadTokens).toBe(30);
    expect('cacheWriteTokens' in actual).toBe(false);
  });

  // ----- AC-4 attempt fields -----

  it('forwards attemptIndex and attemptOutcome', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-attempt',
      { promptTokens: 100, attemptIndex: 1, attemptOutcome: 'error' },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect(actual.attemptIndex).toBe(1);
    expect(actual.attemptOutcome).toBe('error');
  });

  it('omits attempt fields when not provided', async () => {
    const recordActual = vi.fn().mockResolvedValue(undefined);

    await recordActualTokenUsage(
      { isEnabled: () => true, recordActual },
      'prompt-no-attempt',
      { promptTokens: 100 },
    );

    const actual = recordActual.mock.calls[0]?.[1];
    expect('attemptIndex' in actual).toBe(false);
    expect('attemptOutcome' in actual).toBe(false);
  });
});
