/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { act } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import { renderHook } from '../../test-utils/render.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import type { AppAction } from '../reducers/appReducer.js';
import { useAuthCommand } from './useAuthCommand.js';
import { SettingScope } from '../../config/settings.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

const createWrapper = (dispatch: React.Dispatch<AppAction>) =>
  function AuthCommandTestWrapper({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element {
    return (
      <AppDispatchProvider value={dispatch}>{children}</AppDispatchProvider>
    );
  };

function createDialogs() {
  return {
    auth: { open: vi.fn(), close: vi.fn() },
  } as unknown as DialogOpeners;
}

describe('useAuthCommand', () => {
  it('keeps relogin gated when an auth option is selected', async () => {
    const appDispatch = vi.fn<React.Dispatch<AppAction>>();
    const setAuthError = vi.fn<(error: string | null) => void>();
    const dialogs = createDialogs();

    const { result } = renderHook(() => useAuthCommand(dialogs, setAuthError), {
      wrapper: createWrapper(appDispatch),
    });

    await act(async () => {
      await result.current.handleAuthSelect('anthropic', SettingScope.User);
    });

    expect(dialogs.auth.close).toHaveBeenCalledTimes(1);
    expect(setAuthError).toHaveBeenCalledWith(null);
    expect(appDispatch).toHaveBeenCalledWith({
      type: 'SET_AUTH_ERROR',
      payload: null,
    });
    expect(appDispatch).not.toHaveBeenCalledWith({
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });
  });
});
