/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { renderHook } from '../../test-utils/render.js';
import { useBanner } from './useBanner.js';
import { persistentState } from '../../utils/persistentState.js';

vi.mock('../../utils/persistentState.js', () => ({
  persistentState: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe('useBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (persistentState.get as ReturnType<typeof vi.fn>).mockReturnValue({});
  });

  it('returns empty bannerText when both defaultText and warningText are empty', () => {
    const { result } = renderHook(() =>
      useBanner({ defaultText: '', warningText: '' }),
    );
    expect(result.current.bannerText).toBe('');
  });

  it('returns warningText when warningText is present', () => {
    const { result } = renderHook(() =>
      useBanner({ defaultText: 'default banner', warningText: 'warning!' }),
    );
    expect(result.current.bannerText).toBe('warning!');
  });

  it('returns defaultText when warningText is empty and count is below max', () => {
    const { result } = renderHook(() =>
      useBanner({ defaultText: 'Welcome to LLxprt', warningText: '' }),
    );
    expect(result.current.bannerText).toBe('Welcome to LLxprt');
  });

  it('suppresses defaultText when count is at or above max (5)', () => {
    // Simulate the banner having been shown 5 times already
    const hash = crypto.createHash('sha256').update('Hello').digest('hex');
    (persistentState.get as ReturnType<typeof vi.fn>).mockReturnValue({
      [hash]: 5,
    });

    const { result } = renderHook(() =>
      useBanner({ defaultText: 'Hello', warningText: '' }),
    );
    // When count >= 5 and no warning, bannerText should be empty (warningText)
    expect(result.current.bannerText).toBe('');
  });

  it('increments persisted count on first eligible render', () => {
    (persistentState.get as ReturnType<typeof vi.fn>).mockReturnValue({});

    renderHook(() => useBanner({ defaultText: 'New banner', warningText: '' }));

    expect(persistentState.set).toHaveBeenCalledWith(
      'defaultBannerShownCount',
      expect.any(Object) as Record<string, number>,
    );
  });

  it('does not increment count when defaultText is empty', () => {
    renderHook(() => useBanner({ defaultText: '', warningText: '' }));
    expect(persistentState.set).not.toHaveBeenCalled();
  });

  it('converts literal backslash-n sequences into newlines', () => {
    const { result } = renderHook(() =>
      useBanner({ defaultText: 'line1\\nline2', warningText: '' }),
    );
    expect(result.current.bannerText).toBe('line1\nline2');
  });
});
