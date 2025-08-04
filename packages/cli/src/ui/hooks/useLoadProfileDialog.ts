/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { ProfileManager, AuthType, Config } from '@vybestack/llxprt-code-core';
import {
  LoadedSettings,
  SettingScope,
  Settings,
} from '../../config/settings.js';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import {
  setProviderApiKey,
  setProviderBaseUrl,
} from '../../providers/providerConfigUtils.js';

interface UseLoadProfileDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  appState: AppState;
  config: Config;
  settings: LoadedSettings;
}

export const useLoadProfileDialog = ({
  addMessage,
  appState,
  config,
  settings,
}: UseLoadProfileDialogParams) => {
  const appDispatch = useAppDispatch();
  const showDialog = appState.openDialogs.loadProfile;
  const [profiles, setProfiles] = useState<string[]>([]);

  const openDialog = useCallback(async () => {
    try {
      const profileManager = new ProfileManager();
      const availableProfiles = await profileManager.listProfiles();
      setProfiles(availableProfiles);
      appDispatch({ type: 'OPEN_DIALOG', payload: 'loadProfile' });
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load profiles: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, appDispatch]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'loadProfile' }),
    [appDispatch],
  );

  const handleSelect = useCallback(
    async (profileName: string) => {
      try {
        // Load the profile
        const profileManager = new ProfileManager();
        const profile = await profileManager.loadProfile(profileName);

        // Apply settings in the correct order:
        // 1. Set provider first
        const providerManager = config.getProviderManager();
        if (providerManager) {
          providerManager.setActiveProvider(profile.provider);

          // Ensure provider manager is set on config
          config.setProviderManager(providerManager);

          // Update the provider in config
          config.setProvider(profile.provider);
        }

        // 2. Set model second
        config.setModel(profile.model);

        // 3. Apply ephemeral settings third
        for (const [key, value] of Object.entries(profile.ephemeralSettings)) {
          // Special handling for auth-key and base-url
          if (key === 'auth-key' && typeof value === 'string') {
            // Set API key for the provider - use the concrete provider manager
            const concreteProviderManager = getProviderManager();
            await setProviderApiKey(
              concreteProviderManager,
              settings,
              value,
              config,
            );
          } else if (key === 'base-url' && typeof value === 'string') {
            // Set base URL for the provider - use the concrete provider manager
            const concreteProviderManager = getProviderManager();
            await setProviderBaseUrl(concreteProviderManager, settings, value);
          } else {
            // Use setValue with SettingScope.User for other ephemeral settings
            settings.setValue(SettingScope.User, key as keyof Settings, value);
          }
        }

        // 4. Call provider.setModelParams()
        const activeProvider = providerManager?.getActiveProvider();
        if (
          activeProvider &&
          'setModelParams' in activeProvider &&
          activeProvider.setModelParams
        ) {
          if (
            profile.modelParams &&
            Object.keys(profile.modelParams).length > 0
          ) {
            activeProvider.setModelParams(profile.modelParams);
          }
        }

        // 5. Refresh auth to ensure provider is properly initialized
        const currentAuthType =
          config.getContentGeneratorConfig()?.authType ||
          AuthType.LOGIN_WITH_GOOGLE;

        await config.refreshAuth(currentAuthType);

        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' loaded`,
          timestamp: new Date(),
        });
      } catch (error) {
        // Handle specific error messages
        if (error instanceof Error) {
          if (error.message.includes('not found')) {
            addMessage({
              type: MessageType.ERROR,
              content: `Profile '${profileName}' not found`,
              timestamp: new Date(),
            });
          } else if (error.message.includes('corrupted')) {
            addMessage({
              type: MessageType.ERROR,
              content: `Profile '${profileName}' is corrupted`,
              timestamp: new Date(),
            });
          } else if (error.message.includes('missing required fields')) {
            addMessage({
              type: MessageType.ERROR,
              content: `Profile '${profileName}' is invalid: missing required fields`,
              timestamp: new Date(),
            });
          } else {
            addMessage({
              type: MessageType.ERROR,
              content: `Failed to load profile: ${error.message}`,
              timestamp: new Date(),
            });
          }
        } else {
          addMessage({
            type: MessageType.ERROR,
            content: `Failed to load profile: ${String(error)}`,
            timestamp: new Date(),
          });
        }
      }
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'loadProfile' });
    },
    [addMessage, appDispatch, config, settings],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    profiles,
    handleSelect,
  };
};
