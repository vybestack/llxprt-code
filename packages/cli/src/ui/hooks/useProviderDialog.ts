/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { Config, type RecordingIntegration } from '@vybestack/llxprt-code-core';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

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
  recordingIntegration?: RecordingIntegration;
}

export const useProviderDialog = ({
  addMessage,
  onProviderChange,
  appState,
  config: _config,
  onClear,
  recordingIntegration,
}: UseProviderDialogParams) => {
  const appDispatch = useAppDispatch();
  const runtime = useRuntimeApi();
  const showDialog = appState.openDialogs.provider;
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');

  const openDialog = useCallback(() => {
    try {
      setProviders(runtime.listProviders());
      setCurrentProvider(runtime.getActiveProviderName());
      appDispatch({ type: 'OPEN_DIALOG', payload: 'provider' });
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load providers: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, appDispatch, runtime]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'provider' }),
    [appDispatch],
  );

  const handleSelect = useCallback(
    async (providerName: string) => {
      try {
        const prev = runtime.getActiveProviderName();
        /**
         * @plan:PLAN-20250218-STATELESSPROVIDER.P06
         * @requirement:REQ-SP-005
         * @pseudocode:cli-runtime.md line 9
         */
        const result = await runtime.switchActiveProvider(providerName);

        // Clear UI history to prevent tool call ID mismatches
        if (onClear) {
          onClear();
        }

        addMessage({
          type: MessageType.INFO,
          content: `Switched from ${prev || 'none'} to ${providerName}`,
          timestamp: new Date(),
        });

        for (const info of result.infoMessages) {
          addMessage({
            type: MessageType.INFO,
            content: info,
            timestamp: new Date(),
          });
        }

        setCurrentProvider(result.nextProvider);
        recordingIntegration?.recordProviderSwitch(
          result.nextProvider,
          result.defaultModel ?? runtime.getActiveModelName(),
        );
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
    [
      addMessage,
      onProviderChange,
      appDispatch,
      onClear,
      runtime,
      recordingIntegration,
    ],
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
