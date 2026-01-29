/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '../../test-utils/render.js';
import { useStableCallback, useStableGetter } from './useStableCallback.js';

describe('useStableCallback', () => {
  it('should maintain a stable callback reference', () => {
    let count = 0;
    const { result, rerender } = renderHook(
      () => useStableCallback(() => count),
      { initialProps: {} },
    );

    const firstCallback = result.current;

    // Change the external variable
    count = 1;
    rerender();

    const secondCallback = result.current;

    // Callback reference should be stable
    expect(firstCallback).toBe(secondCallback);

    // But it should use the latest value
    expect(secondCallback()).toBe(1);
  });

  it('should always call the latest callback version', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useStableCallback(() => value),
      { initialProps: { value: 'initial' } },
    );

    expect(result.current()).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current()).toBe('updated');
  });

  it('should pass arguments correctly', () => {
    const addFunction = (...args: unknown[]) => {
      const [a, b] = args as [number, number];
      return a + b;
    };
    const { result } = renderHook(() => useStableCallback(addFunction));

    expect(result.current(2, 3)).toBe(5);
  });
});

describe('useStableGetter', () => {
  it('should maintain a stable getter reference', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useStableGetter(value),
      { initialProps: { value: 0 } },
    );

    const firstGetter = result.current;

    rerender({ value: 1 });

    const secondGetter = result.current;

    // Getter reference should be stable
    expect(firstGetter).toBe(secondGetter);

    // But it should return the latest value
    expect(secondGetter()).toBe(1);
  });

  it('should always return the latest value', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useStableGetter(value),
      { initialProps: { value: 'initial' } },
    );

    expect(result.current()).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current()).toBe('updated');

    rerender({ value: 'final' });
    expect(result.current()).toBe('final');
  });
});
