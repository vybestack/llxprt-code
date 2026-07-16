/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useUnconfiguredProviderGuidance } from './useUnconfiguredProviderGuidance.js';

describe('useUnconfiguredProviderGuidance', () => {
  let addItem: Mock;

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
        isWelcomeDialogOpen: false,
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
        isWelcomeDialogOpen: false,
      }),
    );
    expect(addItem).not.toHaveBeenCalled();
  });

  it('does NOT show guidance when the welcome dialog is open', () => {
    renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: false,
        addItem,
        isWelcomeDialogOpen: true,
      }),
    );
    expect(addItem).not.toHaveBeenCalled();
  });

  it('does NOT show guidance twice on re-render (idempotent)', () => {
    const { rerender } = renderHook(() =>
      useUnconfiguredProviderGuidance({
        hasActiveProvider: false,
        addItem,
        isWelcomeDialogOpen: false,
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
          isWelcomeDialogOpen: false,
        }),
      { initialProps: { hasActiveProvider: true } },
    );
    expect(addItem).not.toHaveBeenCalled();

    rerender({ hasActiveProvider: false });
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('closes guidance on transition from welcome open to welcome closed', () => {
    const { rerender } = renderHook(
      ({ isWelcomeDialogOpen }) =>
        useUnconfiguredProviderGuidance({
          hasActiveProvider: false,
          addItem,
          isWelcomeDialogOpen,
        }),
      { initialProps: { isWelcomeDialogOpen: true } },
    );
    expect(addItem).not.toHaveBeenCalled();

    rerender({ isWelcomeDialogOpen: false });
    expect(addItem).toHaveBeenCalledTimes(1);
  });
});
