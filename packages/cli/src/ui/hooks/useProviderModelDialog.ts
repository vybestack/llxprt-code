/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { IModel } from '../../providers/IModel.js';
import { MessageType } from '../types.js';

interface UseProviderModelDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  onModelChange?: () => void;
}

export const useProviderModelDialog = ({
  addMessage,
  onModelChange,
}: UseProviderModelDialogParams) => {
  const [showDialog, setShowDialog] = useState(false);
  const [models, setModels] = useState<IModel[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');

  const openDialog = useCallback(async () => {
    try {
      const provider = getProviderManager().getActiveProvider();
      const list = await provider.getModels();
      setModels(list);
      setCurrentModel(provider.getCurrentModel?.() ?? '');
      setShowDialog(true);
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load models: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage]);

  const closeDialog = useCallback(() => setShowDialog(false), []);

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
      setShowDialog(false);
    },
    [addMessage, onModelChange],
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
