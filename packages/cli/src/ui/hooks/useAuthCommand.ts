/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

export const useAuthCommand = (
  settings: LoadedSettings,
  appState: AppState,
) => {
  const appDispatch = useAppDispatch();
  const isAuthDialogOpen = appState.openDialogs.auth;

  const openAuthDialog = useCallback(() => {
    appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
  }, [appDispatch]);

  const handleAuthSelect = useCallback(
    async (_selection: string | undefined, _scope: SettingScope) => {
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'auth' });
      appDispatch({ type: 'SET_AUTH_ERROR', payload: null });
    },
    [appDispatch],
  );

  return {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
  };
};
