import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import type { AppAction, AppState } from '../reducers/appReducer.js';
import { initialAppState } from '../reducers/appReducer.js';
import { useAuthCommand } from './useAuthCommand.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';

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

describe('useAuthCommand', () => {
  it('keeps relogin gated when an auth option is selected', async () => {
    const appDispatch = vi.fn<React.Dispatch<AppAction>>();
    const setAuthError = vi.fn<(error: string | null) => void>();
    const appState: AppState = {
      ...initialAppState,
      openDialogs: { ...initialAppState.openDialogs, auth: true },
      needsRelogin: true,
    };

    const { result } = renderHook(
      () => useAuthCommand({} as LoadedSettings, appState, setAuthError),
      { wrapper: createWrapper(appDispatch) },
    );

    await act(async () => {
      await result.current.handleAuthSelect('anthropic', SettingScope.User);
    });

    expect(appDispatch).toHaveBeenCalledWith({
      type: 'CLOSE_DIALOG',
      payload: 'auth',
    });
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
