/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useEffect } from 'react';

/**
 * Custom hook that provides a stable callback reference while always calling the latest function.
 * This prevents unnecessary re-renders in components that depend on callbacks.
 *
 * @param callback The callback function that may change between renders
 * @returns A stable callback that always invokes the latest version
 *
 * @example
 * ```typescript
 * // Instead of:
 * const handleClick = useCallback(() => {
 *   console.log(count); // This creates new callback when count changes
 * }, [count]);
 *
 * // Use:
 * const handleClick = useStableCallback(() => {
 *   console.log(count); // Stable reference, but always uses latest count
 * });
 * ```
 */
export function useStableCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
): T {
  // Store the latest callback in a ref
  const callbackRef = useRef<T>(callback);

  // Update the ref whenever the callback changes
  useEffect(() => {
    callbackRef.current = callback;
  });

  // Return a stable callback that always calls the latest version
  const stableCallback = useCallback(
    (...args: Parameters<T>) => callbackRef.current(...args),
    [], // Empty deps = stable reference
  ) as T;

  return stableCallback;
}

/**
 * Hook that provides a stable getter function for a value.
 * Useful for creating stable getters that always return the latest value.
 *
 * @param value The value to create a getter for
 * @returns A stable getter function
 *
 * @example
 * ```typescript
 * const getCount = useStableGetter(count);
 * // getCount is stable but always returns the latest count
 * ```
 */
export function useStableGetter<T>(value: T): () => T {
  const valueRef = useRef<T>(value);

  useEffect(() => {
    valueRef.current = value;
  });

  return useCallback(() => valueRef.current, []);
}
