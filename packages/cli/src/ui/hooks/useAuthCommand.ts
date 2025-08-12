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

        // Apply compression settings after authentication
        const contextLimit = config.getEphemeralSetting('context-limit') as
          | number
          | undefined;
        const compressionThreshold = config.getEphemeralSetting(
          'compression-threshold',
        ) as number | undefined;

        if (contextLimit || compressionThreshold) {
          const geminiClient = config.getGeminiClient();
          if (geminiClient) {
            geminiClient.setCompressionSettings(
              compressionThreshold,
              contextLimit,
            );
          }
        }

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
        const errorMessage = getErrorMessage(e);
        appDispatch({
          type: 'SET_AUTH_ERROR',
          payload: `Failed to login. Message: ${errorMessage}`,
        });
        // NEVER automatically open auth dialog - user must use /auth command
      } finally {
        setIsAuthenticating(false);
      }
    };

    void authFlow();
  }, [isAuthDialogOpen, settings, config, appDispatch, openAuthDialog]);

  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      // Handle OAuth provider selections
      if (
        authType === AuthType.OAUTH_GEMINI ||
        authType === AuthType.OAUTH_QWEN ||
        authType === AuthType.OAUTH_ANTHROPIC
      ) {
        // Trigger the OAuth flow directly
        let provider: string;
        if (authType === AuthType.OAUTH_GEMINI) {
          provider = 'gemini';
        } else if (authType === AuthType.OAUTH_QWEN) {
          provider = 'qwen';
        } else {
          provider = 'anthropic';
        }

        // Close the dialog first
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'auth' });
        appDispatch({ type: 'SET_AUTH_ERROR', payload: null });

        // Get the existing OAuth manager from provider manager
        const { getOAuthManager } = await import(
          '../../providers/providerManagerInstance.js'
        );
        const oauthManager = getOAuthManager();

        if (!oauthManager) {
          console.error('OAuth manager not initialized');
          appDispatch({
            type: 'SET_AUTH_ERROR',
            payload:
              'OAuth system not initialized. Please restart the application.',
          });
          return;
        }

        // Trigger authentication
        try {
          await oauthManager.authenticate(provider);
          console.log(`Successfully authenticated with ${provider}!`);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(`Authentication failed: ${errorMessage}`);
          appDispatch({
            type: 'SET_AUTH_ERROR',
            payload: `Failed to authenticate with ${provider}: ${errorMessage}`,
          });
        }

        return;
      }

      // Handle legacy auth types (for backward compatibility)
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
