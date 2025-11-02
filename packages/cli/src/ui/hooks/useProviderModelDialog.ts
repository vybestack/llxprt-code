/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import type { IModel } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

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
  const runtime = useRuntimeApi();
  const showDialog = appState.openDialogs.providerModel;
  const [models, setModels] = useState<IModel[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');

  const openDialog = useCallback(async () => {
    try {
      const list = await runtime.listAvailableModels();
      setModels(list);
      setCurrentModel(runtime.getActiveModelName());
      appDispatch({ type: 'OPEN_DIALOG', payload: 'providerModel' });
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load models: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage, appDispatch, runtime]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'providerModel' }),
    [appDispatch],
  );

  const handleSelect = useCallback(
    async (modelId: string) => {
      try {
        const result = await runtime.setActiveModel(modelId);
        addMessage({
          type: MessageType.INFO,
          content: `Switched from ${result.previousModel ?? 'unknown'} to ${result.nextModel} in provider '${result.providerName}'`,
          timestamp: new Date(),
        });
        onModelChange?.();
      } catch (e) {
        const status = runtime.getActiveProviderStatus();
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to switch model for provider '${status.providerName ?? 'unknown'}': ${e instanceof Error ? e.message : String(e)}`,
          timestamp: new Date(),
        });
      }
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'providerModel' });
    },
    [addMessage, onModelChange, appDispatch, runtime],
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
