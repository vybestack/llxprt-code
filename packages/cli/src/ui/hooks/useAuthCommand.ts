/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import {
  AuthType,
  Config,
  clearCachedCredentialFile,
  getErrorMessage,
} from '@vybestack/llxprt-code-core';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { runExitCleanup } from '../../utils/cleanup.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';

export const useAuthCommand = (
  settings: LoadedSettings,
  appState: AppState,
  config: Config,
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

  useEffect(() => {
    const authFlow = async () => {
      const authType = settings.merged.selectedAuthType;
      if (isAuthDialogOpen || !authType) {
        return;
      }

      try {
        setIsAuthenticating(true);
        await config.refreshAuth(authType);

        // Update serverToolsProvider after authentication
        const providerManager = getProviderManager();
        if (providerManager) {
          const serverToolsProvider = providerManager.getServerToolsProvider();
          if (
            serverToolsProvider &&
            serverToolsProvider.name === 'gemini' &&
            'setConfig' in serverToolsProvider
          ) {
            // This will trigger determineBestAuth() with the new auth state
            const geminiProvider = serverToolsProvider as {
              setConfig: (config: Config) => void;
            };
            geminiProvider.setConfig(config);
          }
        }

        console.log(`Authenticated via "${authType}".`);
      } catch (e) {
        appDispatch({
          type: 'SET_AUTH_ERROR',
          payload: `Failed to login. Message: ${getErrorMessage(e)}`,
        });
        openAuthDialog();
      } finally {
        setIsAuthenticating(false);
      }
    };

    void authFlow();
  }, [isAuthDialogOpen, settings, config, appDispatch, openAuthDialog]);

  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      if (authType) {
        await clearCachedCredentialFile();

        settings.setValue(scope, 'selectedAuthType', authType);
        if (
          authType === AuthType.LOGIN_WITH_GOOGLE &&
          config.isBrowserLaunchSuppressed()
        ) {
          runExitCleanup();
          console.log(
            `
----------------------------------------------------------------
Logging in with Google... Please restart Gemini CLI to continue.
----------------------------------------------------------------
            `,
          );
          process.exit(0);
        }
      }
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'auth' });
      appDispatch({ type: 'SET_AUTH_ERROR', payload: null });
    },
    [settings, appDispatch, config],
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
