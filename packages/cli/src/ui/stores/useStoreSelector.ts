/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useSyncExternalStore } from 'react';
import type { Store } from './createStore.js';

/**
 * Subscribes to a {@link Store} and returns the selected slice. The snapshot is
 * the last selected value, cached by state reference, so useSyncExternalStore
 * only re-renders when the selected value stops being equal (Object.is by
 * default). A non-equal cached value is replaced every call; enabling a custom
 * `isEqual` suppresses re-renders for equal selections produced from a new state.
 */
export function useStoreSelector<S, Sel>(
  store: Store<S>,
  selector: (state: S) => Sel,
): Sel {
  const storeRef = useRef(store);
  const selectorRef = useRef(selector);
  storeRef.current = store;
  selectorRef.current = selector;

  const cacheRef = useRef<{ state: S; value: unknown } | null>(null);
  const lastSelectorRef = useRef(selector);
  if (lastSelectorRef.current !== selector) {
    lastSelectorRef.current = selector;
    cacheRef.current = null;
  }

  const select = (): unknown => {
    const state = storeRef.current.getState();
    const cached = cacheRef.current;
    if (cached !== null && cached.state === state) {
      return cached.value;
    }
    const value = selectorRef.current(state);
    cacheRef.current = { state, value };
    return value;
  };

  return useSyncExternalStore(store.subscribe, select, select) as Sel;
}
