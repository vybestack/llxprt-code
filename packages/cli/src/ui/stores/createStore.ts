/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Store<S> {
  getState: () => S;
  setState: (next: S | ((prev: S) => S)) => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Minimal external store primitive. Setters replace the whole state reference and
 * notify every listener, including identical-reference writes. Commands own
 * equality policy: settings assignments skip equal writes; terminal geometry
 * writes invalidate state references, while focus/color/placeholder no-ops
 * retain references but still notify. Selectors compare selected values with
 * Object.is. Callers must not assume every notification changes identity.
 * No cloning: the caller owns immutability.
 */
export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();

  const getState = (): S => state;

  const setState = (next: S | ((prev: S) => S)): void => {
    state = typeof next === 'function' ? (next as (prev: S) => S)(state) : next;
    for (const listener of listeners) {
      listener();
    }
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState, setState, subscribe };
}
