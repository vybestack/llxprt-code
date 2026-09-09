/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useUnconfiguredProviderGuidance } from './useUnconfiguredProviderGuidance.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import type { HistoryItemWithoutId } from '../types.js';

describe('useUnconfiguredProviderGuidance', () => {
  let addItem: Mock<(item: HistoryItemWithoutId, timestamp?: number) => number>;

  beforeEach(() => {
    addItem = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows /setup guidance when no provider is active and welcome dialog is closed', () => {
    renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: false,
        addItem,
        store: createDialogStore(),
      }),
    );
    expect(addItem).toHaveBeenCalledTimes(1);
    const [item] = addItem.mock.calls[0];
    expect(item.type).toBe('info');
    expect(item.text).toContain('/setup');
    expect(item.text).toContain('hosted provider');
    expect(item.text).toContain('local model');
    expect(item.text).toContain('custom');
    expect(item.text).toContain('profile');
  });

  it('does NOT show guidance when a provider IS active', () => {
    renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: true,
        addItem,
        store: createDialogStore(),
      }),
    );
    expect(addItem).not.toHaveBeenCalled();
  });

  it('does NOT show guidance when the welcome dialog is open in the store', () => {
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'welcome', payload: {} });
    renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: false,
        addItem,
        store,
      }),
    );
    expect(addItem).not.toHaveBeenCalled();
  });

  it('does NOT show guidance twice on re-render (idempotent)', () => {
    const { rerender } = renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: false,
        addItem,
        store: createDialogStore(),
      }),
    );
    rerender();
    rerender();
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('shows guidance on transition from active to inactive provider', () => {
    const { rerender } = renderHook(
      ({ hasActiveProvider }) =>
        useUnconfiguredProviderGuidance({
          hasActiveProvider,
          addItem,
          store: createDialogStore(),
        }),
      { initialProps: { hasActiveProvider: true } },
    );
    expect(addItem).not.toHaveBeenCalled();

    rerender({ hasActiveProvider: false });
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('shows guidance on transition from welcome open to welcome closed', () => {
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'welcome', payload: {} });
    renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: false,
        addItem,
        store,
      }),
    );
    expect(addItem).not.toHaveBeenCalled();

    act(() => {
      store.commands.closeDialog('welcome');
    });
    expect(addItem).toHaveBeenCalledTimes(1);
  });
});
