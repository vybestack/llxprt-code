/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

export const useAuthCommand = (
  settings: LoadedSettings,
  appState: AppState,
  _config: unknown, // DEPRECATED: config param kept for API compat, unused (issue #443)
) => {
  const appDispatch = useAppDispatch();
  const isAuthDialogOpen = appState.openDialogs.auth;

  const openAuthDialog = useCallback(() => {
    appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
  }, [appDispatch]);

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // DEPRECATED: legacy auth selection flow is vestigial (issue #443).
  // Providers (GeminiProvider, etc.) now handle auth detection internally via determineBestAuth().
  // OAuth is triggered lazily on first API call, not on startup.
  // This effect is intentionally disabled - keeping structure for potential future use.

  const handleAuthSelect = useCallback(
    async (_selection: string | undefined, _scope: SettingScope) => {
      // Legacy auth selection is deprecated; simply close the dialog.
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'auth' });
      appDispatch({ type: 'SET_AUTH_ERROR', payload: null });
    },
    [appDispatch],
  );

  const cancelAuthentication = useCallback(() => {
    setIsAuthenticating(false);
  }, []);

  return {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
  };
};
