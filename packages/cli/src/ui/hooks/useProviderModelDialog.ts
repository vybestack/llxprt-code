/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { IModel } from '../../providers/index.js';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';

interface UseProviderModelDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  onModelChange?: () => void;
  appState: AppState;
}

export const useProviderModelDialog = ({
  addMessage,
  onModelChange,
  appState,
}: UseProviderModelDialogParams) => {
  const appDispatch = useAppDispatch();
  const showDialog = appState.openDialogs.providerModel;
  const [models, setModels] = useState<IModel[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');

  const openDialog = useCallback(async () => {
    try {
      const provider = getProviderManager().getActiveProvider();
      const list = await provider.getModels();
      setModels(list);
      setCurrentModel(provider.getCurrentModel?.() ?? '');
      appDispatch({ type: 'OPEN_DIALOG', payload: 'providerModel' });
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load models: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, appDispatch]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'providerModel' }),
    [appDispatch],
  );

  const handleSelect = useCallback(
    (modelId: string) => {
      try {
        const provider = getProviderManager().getActiveProvider();
        const prev = provider.getCurrentModel?.() ?? '';
        provider.setModel?.(modelId);
        addMessage({
          type: MessageType.INFO,
          content: `Switched from ${prev} to ${modelId} in provider '${provider.name}'`,
          timestamp: new Date(),
        });
        onModelChange?.();
      } catch (e) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to switch model: ${e instanceof Error ? e.message : String(e)}`,
          timestamp: new Date(),
        });
      }
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'providerModel' });
    },
    [addMessage, onModelChange, appDispatch],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    models,
    currentModel,
    handleSelect,
  };
};
