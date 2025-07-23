/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { AuthType, Config } from '@vybestack/llxprt-code-core';

interface UseProviderDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  onProviderChange?: () => void;
  appState: AppState;
  config: Config;
  onClear?: () => void;
}

export const useProviderDialog = ({
  addMessage,
  onProviderChange,
  appState,
  config,
  onClear,
}: UseProviderDialogParams) => {
  const appDispatch = useAppDispatch();
  const showDialog = appState.openDialogs.provider;
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');

  const openDialog = useCallback(() => {
    try {
      const providerManager = getProviderManager();
      setProviders(providerManager.listProviders());
      setCurrentProvider(providerManager.getActiveProviderName());
      appDispatch({ type: 'OPEN_DIALOG', payload: 'provider' });
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load providers: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, appDispatch]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'provider' }),
    [appDispatch],
  );

  const handleSelect = useCallback(
    async (providerName: string) => {
      try {
        const providerManager = getProviderManager();
        const prev = providerManager.getActiveProviderName();

        // Switch provider first
        providerManager.setActiveProvider(providerName);

        // Ensure provider manager is set on config
        config.setProviderManager(providerManager);

        // Update model to match the new provider's default
        const newModel =
          providerManager.getActiveProvider().getCurrentModel?.() || '';
        config.setModel(newModel);

        // Clear conversation history BEFORE switching to prevent tool call ID mismatches
        const geminiClient = config.getGeminiClient();
        if (geminiClient && geminiClient.isInitialized()) {
          await geminiClient.resetChat();
        }

        // Determine appropriate auth type
        let authType: AuthType;

        if (providerName === 'gemini') {
          // When switching TO Gemini, determine appropriate auth
          const currentAuthType = config.getContentGeneratorConfig()?.authType;

          // If we were using provider auth, switch to appropriate Gemini auth
          if (currentAuthType === AuthType.USE_PROVIDER || !currentAuthType) {
            if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
              authType = AuthType.USE_VERTEX_AI;
            } else if (process.env.GEMINI_API_KEY) {
              authType = AuthType.USE_GEMINI;
            } else {
              authType = AuthType.LOGIN_WITH_GOOGLE; // Default to OAuth
            }
          } else {
            // Keep existing Gemini auth type
            authType = currentAuthType;
          }
        } else {
          // When switching to non-Gemini provider
          authType = AuthType.USE_PROVIDER;
        }

        // Refresh auth with the appropriate type
        await config.refreshAuth(authType);

        // Clear UI history to prevent tool call ID mismatches
        if (onClear) {
          onClear();
        }

        addMessage({
          type: MessageType.INFO,
          content: `Switched from ${prev || 'none'} to ${providerName}`,
          timestamp: new Date(),
        });

        // Show additional info for non-Gemini providers
        if (providerName !== 'gemini') {
          addMessage({
            type: MessageType.INFO,
            content: `Use /key to set API key if needed.`,
            timestamp: new Date(),
          });
        }

        onProviderChange?.();
      } catch (e) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to switch provider: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: new Date(),
        });
      }
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'provider' });
    },
    [addMessage, onProviderChange, appDispatch, config, onClear],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    providers,
    currentProvider,
    handleSelect,
  };
};
