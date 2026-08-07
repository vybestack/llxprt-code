/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for `useRetractableHistory().removeItems` (issue #3048 REQ-3048-009).
 * A discard-and-restart retracts exactly the static history item ids the
 * abandoned attempt committed, so the retraction surface must: remove only the
 * requested ids, preserve order, ignore unknown ids, recompute the byte/length
 * budget, and be a no-op (returning the prior state) when nothing matches.
 *
 * Drives the REAL `useHistory` hook via `renderHook`. No mocks.
 *
 * @plan PLAN-20260806-ISSUE3048.P11
 * @requirement REQ-3048-009
 */

import { describe, it, expect } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import { useRetractableHistory } from '../useHistoryManager.js';

function addItem(
  result: { current: ReturnType<typeof useRetractableHistory> },
  text: string,
  timestamp = 1_000,
): number {
  let id = -1;
  act(() => {
    id = result.current.addItem({ type: 'info', text }, timestamp);
  });
  return id;
}

function textsOf(result: {
  current: ReturnType<typeof useRetractableHistory>;
}): string[] {
  return result.current.history
    .map((item) => (item.type === 'info' ? item.text : undefined))
    .filter((text): text is string => text !== undefined);
}

describe('useRetractableHistory().removeItems (issue #3048 REQ-3048-009)', () => {
  it('removes exactly the given ids and preserves order', () => {
    const { result } = renderHook(() => useRetractableHistory());
    const a = addItem(result, 'a');
    const b = addItem(result, 'b');
    const c = addItem(result, 'c');

    act(() => {
      result.current.removeItems([b]);
    });

    const remaining = textsOf(result);
    expect(remaining).toStrictEqual(['a', 'c']);
    expect(result.current.history.some((item) => item.id === b)).toBe(false);
    expect(result.current.history.some((item) => item.id === a)).toBe(true);
    expect(result.current.history.some((item) => item.id === c)).toBe(true);
  });

  it('removes multiple ids at once while preserving order', () => {
    const { result } = renderHook(() => useRetractableHistory());
    const a = addItem(result, 'a');
    const b = addItem(result, 'b');
    const c = addItem(result, 'c');
    const d = addItem(result, 'd');

    act(() => {
      result.current.removeItems([a, c]);
    });

    expect(textsOf(result)).toStrictEqual(['b', 'd']);
    expect(result.current.history.some((item) => item.id === b)).toBe(true);
    expect(result.current.history.some((item) => item.id === d)).toBe(true);
  });

  it('ignores unknown ids without disturbing existing entries', () => {
    const { result } = renderHook(() => useRetractableHistory());
    const a = addItem(result, 'a');
    addItem(result, 'b');

    act(() => {
      result.current.removeItems([a, 9_999_999]);
    });

    expect(textsOf(result)).toStrictEqual(['b']);
  });

  it('is a no-op for an empty id list (state identity preserved)', () => {
    const { result } = renderHook(() => useRetractableHistory());
    addItem(result, 'a');
    addItem(result, 'b');
    const before = result.current.history;

    act(() => {
      result.current.removeItems([]);
    });

    expect(result.current.history).toBe(before);
    expect(textsOf(result)).toStrictEqual(['a', 'b']);
  });

  it('is a no-op when no id matches (state identity preserved)', () => {
    const { result } = renderHook(() => useRetractableHistory());
    addItem(result, 'a');
    addItem(result, 'b');
    const before = result.current.history;

    act(() => {
      result.current.removeItems([888_888, 999_999]);
    });

    expect(result.current.history).toBe(before);
    expect(textsOf(result)).toStrictEqual(['a', 'b']);
  });

  it('recomputes the item budget so a later add is not trimmed against stale state', () => {
    // maxItems: 2 — a third add would normally trim the oldest. Removing one
    // must free that slot so the next add is retained alongside the survivor.
    const { result } = renderHook(() => useRetractableHistory({ maxItems: 2 }));
    addItem(result, 'a');
    const b = addItem(result, 'b');

    act(() => {
      result.current.removeItems([b]);
    });
    expect(textsOf(result)).toStrictEqual(['a']);

    addItem(result, 'c', 3_000);

    // 'a' survived AND 'c' was retained: removal recomputed the budget.
    expect(textsOf(result)).toStrictEqual(['a', 'c']);
  });

  it('retracts ids committed during an abandoned attempt without touching unrelated items', () => {
    const { result } = renderHook(() => useRetractableHistory());
    // Earlier, completed items (a user turn, a prior assistant message).
    let user = -1;
    act(() => {
      user = result.current.addItem({ type: 'user', text: 'question' }, 1_000);
    });
    const priorAi = addItem(result, 'old answer');

    // Abandoned attempt committed two static segments.
    const abandoned1 = addItem(result, 'para one');
    const abandoned2 = addItem(result, 'para two');

    act(() => {
      result.current.removeItems([abandoned1, abandoned2]);
    });

    expect(result.current.history.some((item) => item.id === user)).toBe(true);
    expect(result.current.history.some((item) => item.id === priorAi)).toBe(
      true,
    );
    expect(result.current.history.some((item) => item.id === abandoned1)).toBe(
      false,
    );
    expect(result.current.history.some((item) => item.id === abandoned2)).toBe(
      false,
    );
  });
});
