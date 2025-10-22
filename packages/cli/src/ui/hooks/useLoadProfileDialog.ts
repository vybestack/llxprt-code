/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { Config } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

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
  config: _config,
  settings: _settings,
}: UseLoadProfileDialogParams) => {
  const appDispatch = useAppDispatch();
  const runtime = useRuntimeApi();
  const showDialog = appState.openDialogs.loadProfile;
  const [profiles, setProfiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const openDialog = useCallback(async () => {
    // Clear old profiles and set loading state
    setProfiles([]);
    setIsLoading(true);

    // Open dialog immediately to show loading state
    appDispatch({ type: 'OPEN_DIALOG', payload: 'loadProfile' });

    try {
      const availableProfiles = await runtime.listSavedProfiles();
      setProfiles(availableProfiles);
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load profiles: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
      // Close dialog on error
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'loadProfile' });
    } finally {
      setIsLoading(false);
    }
  }, [addMessage, appDispatch, runtime]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'loadProfile' }),
    [appDispatch],
  );

  const handleSelect = useCallback(
    async (profileName: string) => {
      try {
        const result = await runtime.loadProfileByName(profileName);
        const extra = (result.infoMessages ?? [])
          .map((message) => `\n- ${message}`)
          .join('');
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' loaded${extra}`,
          timestamp: new Date(),
        });
        for (const warning of result.warnings ?? []) {
          addMessage({
            type: MessageType.INFO,
            content: `⚠ ${warning}`,
            timestamp: new Date(),
          });
        }
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
    [addMessage, appDispatch, runtime],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    profiles,
    handleSelect,
    isLoading,
  };
};
