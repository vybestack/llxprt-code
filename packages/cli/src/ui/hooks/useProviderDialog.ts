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

interface UseProviderDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  onProviderChange?: () => void;
  appState: AppState;
}

export const useProviderDialog = ({
  addMessage,
  onProviderChange,
  appState,
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
    (providerName: string) => {
      try {
        const providerManager = getProviderManager();
        const prev = providerManager.getActiveProviderName();
        providerManager.setActiveProvider(providerName);
        addMessage({
          type: MessageType.INFO,
          content: `Switched from ${prev || 'none'} to ${providerName}`,
          timestamp: new Date(),
        });
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
    [addMessage, onProviderChange, appDispatch],
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
