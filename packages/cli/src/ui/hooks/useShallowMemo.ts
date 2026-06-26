/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef } from 'react';

function shallowArrayEqual(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Memoizes the result of `factory` and only recomputes it when the shallow
 * values of `params` change. This is used by the UIState/UIActions builders,
 * which derive a large context object from a flat params bag whose keys are
 * fixed at the call site.
 *
 * It is implemented with `useRef` rather than `useMemo(..., Object.values(p))`
 * so the dependency set is the actual runtime values of the params object,
 * which cannot be expressed as a statically analyzable dependency array.
 */
export function useShallowMemo<T, TParams extends object>(
  factory: () => T,
  params: TParams,
): T {
  const values = Object.values(params);
  const cache = useRef<{ values: unknown[]; result: T } | null>(null);
  if (
    cache.current === null ||
    !shallowArrayEqual(cache.current.values, values)
  ) {
    cache.current = { values, result: factory() };
  }
  return cache.current.result;
}
