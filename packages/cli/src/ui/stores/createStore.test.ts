/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createStore } from './createStore.js';

describe('createStore', () => {
  it('returns the initial state', () => {
    const store = createStore({ count: 1, other: 'x' });
    expect(store.getState()).toStrictEqual({ count: 1, other: 'x' });
  });

  it('replaces state with setState(plain value)', () => {
    const store = createStore(0);
    store.setState(5);
    expect(store.getState()).toBe(5);
  });

  it('applies setState(updater) against the current state', () => {
    const store = createStore(0);
    store.setState((prev) => prev + 2);
    expect(store.getState()).toBe(2);
  });

  it('notifies all subscribers on setState', () => {
    const store = createStore(1);
    const calls: string[] = [];
    const unsubA = store.subscribe(() => calls.push('a'));
    const unsubB = store.subscribe(() => calls.push('b'));
    store.setState(2);
    expect(calls).toStrictEqual(['a', 'b']);
    unsubA();
    store.setState(3);
    expect(calls).toStrictEqual(['a', 'b', 'b']);
    unsubB();
    store.setState(4);
    expect(calls).toStrictEqual(['a', 'b', 'b']);
  });

  it('unsubscribe stops notifications and is idempotent', () => {
    const store = createStore(0);
    const calls: number[] = [];
    const unsub = store.subscribe(() => calls.push(store.getState()));
    store.setState(1);
    unsub();
    store.setState(2);
    expect(calls).toStrictEqual([1]);
    unsub();
    store.setState(3);
    expect(calls).toStrictEqual([1]);
  });
});
