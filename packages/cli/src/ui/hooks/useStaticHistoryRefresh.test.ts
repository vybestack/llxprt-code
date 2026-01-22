/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '../../test-utils/render.js';
import type { HistoryItem } from '../types.js';
import { useStaticHistoryRefresh } from './useStaticHistoryRefresh.js';

const makeHistory = (...ids: number[]): HistoryItem[] =>
  ids.map((id, index) => ({
    id,
    type: index % 2 === 0 ? 'user' : 'gemini',
    text: `item-${id}`,
  }));

describe('useStaticHistoryRefresh', () => {
  it('does not refresh when history only grows', async () => {
    const refreshStatic = vi.fn();
    const { rerender } = renderHook(
      ({ history }) => useStaticHistoryRefresh(history, refreshStatic),
      { initialProps: { history: [] as HistoryItem[] } },
    );

    rerender({ history: makeHistory(1) });
    rerender({ history: makeHistory(1, 2, 3) });

    await waitFor(() => {
      expect(refreshStatic).toHaveBeenCalledTimes(0);
    });
  });

  it('refreshes when history length decreases', async () => {
    const refreshStatic = vi.fn();
    const { rerender } = renderHook(
      ({ history }) => useStaticHistoryRefresh(history, refreshStatic),
      { initialProps: { history: makeHistory(1, 2, 3, 4) } },
    );

    rerender({ history: makeHistory(3, 4) });

    await waitFor(() => {
      expect(refreshStatic).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes when the oldest id changes while length stays constant', async () => {
    const refreshStatic = vi.fn();
    const { rerender } = renderHook(
      ({ history }) => useStaticHistoryRefresh(history, refreshStatic),
      { initialProps: { history: makeHistory(10, 11, 12, 13) } },
    );

    // Simulate trimming the first item while appending a new one.
    rerender({ history: makeHistory(11, 12, 13, 14) });

    await waitFor(() => {
      expect(refreshStatic).toHaveBeenCalledTimes(1);
    });
  });
});
