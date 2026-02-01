/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { AuthType } from '@vybestack/llxprt-code-core';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

export const useAuthCommand = (
  settings: LoadedSettings,
  appState: AppState,
  _config: unknown, // DEPRECATED: config param kept for API compat, unused (issue #443)
) => {
  const appDispatch = useAppDispatch();
  const isAuthDialogOpen = appState.openDialogs.auth;

  // Commented out to implement lazy authentication
  // Auth dialog will only open when explicitly triggered
  // useEffect(() => {
  //   if (settings.merged.selectedAuthType === undefined) {
  //     appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
  //   }
  // }, [settings.merged.selectedAuthType, appDispatch]); // Run only on mount

  const openAuthDialog = useCallback(() => {
    appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
  }, [appDispatch]);

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // DEPRECATED: selectedAuthType-based auth flow is vestigial (issue #443).
  // Providers (GeminiProvider, etc.) now handle auth detection internally via determineBestAuth().
  // OAuth is triggered lazily on first API call, not on startup.
  // This effect is intentionally disabled - keeping structure for potential future use.

  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      // If undefined passed, it means close was selected
      if (authType === undefined) {
        // Close the dialog
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'auth' });
        appDispatch({ type: 'SET_AUTH_ERROR', payload: null });
        return;
      }

      // Save the selected auth type - NO OAuth flow triggering
      settings.setValue(scope, 'selectedAuthType', authType);
      // Don't close dialog - let user continue toggling providers
    },
    [settings, appDispatch],
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
