/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { render } from '../../test-utils/render.js';
import { useAnimatedScrollbar } from './useAnimatedScrollbar.js';
import { debugState } from '../debug.js';
import { theme } from '../semantic-colors.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TestComponent = ({ isFocused = false }: { isFocused?: boolean }) => {
  useAnimatedScrollbar(isFocused, () => {});
  return null;
};

describe('useAnimatedScrollbar', () => {
  beforeEach(() => {
    debugState.debugNumAnimatedComponents = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not increment debugNumAnimatedComponents when not focused', () => {
    render(<TestComponent isFocused={false} />);
    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('should not increment debugNumAnimatedComponents on initial mount even if focused', () => {
    render(<TestComponent isFocused={true} />);
    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('should increment debugNumAnimatedComponents when becoming focused', () => {
    const { rerender } = render(<TestComponent isFocused={false} />);
    expect(debugState.debugNumAnimatedComponents).toBe(0);
    rerender(<TestComponent isFocused={true} />);
    expect(debugState.debugNumAnimatedComponents).toBe(1);
  });

  it('should decrement debugNumAnimatedComponents when becoming unfocused', () => {
    const { rerender } = render(<TestComponent isFocused={false} />);
    rerender(<TestComponent isFocused={true} />);
    expect(debugState.debugNumAnimatedComponents).toBe(1);
    rerender(<TestComponent isFocused={false} />);
    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('should decrement debugNumAnimatedComponents on unmount', () => {
    const { rerender, unmount } = render(<TestComponent isFocused={false} />);
    rerender(<TestComponent isFocused={true} />);
    expect(debugState.debugNumAnimatedComponents).toBe(1);
    unmount();
    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('should decrement debugNumAnimatedComponents after animation finishes', async () => {
    const { rerender } = render(<TestComponent isFocused={false} />);
    rerender(<TestComponent isFocused={true} />);
    expect(debugState.debugNumAnimatedComponents).toBe(1);

    // Advance timers by enough time for animation to complete (200 + 1000 + 300 + buffer)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('should not leak debug counter when flashScrollbar hits early return', () => {
    // Save originals
    const origText = theme.text;

    // Override theme.text to make secondary undefined → triggers early return
    Object.defineProperty(theme, 'text', {
      get: () => ({ ...origText, secondary: undefined }),
      configurable: true,
    });

    const { rerender } = render(<TestComponent isFocused={false} />);
    expect(debugState.debugNumAnimatedComponents).toBe(0);

    // Focus transition triggers flashScrollbar, which should hit the early return
    rerender(<TestComponent isFocused={true} />);

    // Counter must stay at 0 — no real animation was started
    expect(debugState.debugNumAnimatedComponents).toBe(0);

    // Restore
    Object.defineProperty(theme, 'text', {
      get: () => origText,
      configurable: true,
    });
  });

  it('should not crash if Date.now() goes backwards (regression test)', async () => {
    // Only fake timers, keep Date real so we can mock it manually
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    const dateSpy = vi.spyOn(Date, 'now');
    let currentTime = 1000;
    dateSpy.mockImplementation(() => currentTime);

    const { rerender } = render(<TestComponent isFocused={false} />);

    // Start animation. This captures start = 1000.
    rerender(<TestComponent isFocused={true} />);

    // Simulate time going backwards before the next frame
    currentTime = 900;

    // Trigger the interval (33ms)
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // If it didn't crash, we are good.
    // Cleanup
    dateSpy.mockRestore();
    // Reset timers to default full fake for other tests (handled by afterEach/beforeEach usually, but here we overrode it)
  });
});
