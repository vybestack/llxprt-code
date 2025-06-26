/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { Config } from '@google/gemini-cli-core';
import { MessageType } from '../types.js';

interface UseModelCommandProps {
  config: Config | null;
  addMessage: (message: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
}

export const useModelCommand = ({ config, addMessage }: UseModelCommandProps) => {
  const [showModelDialog, setShowModelDialog] = useState(false);

  const openModelDialog = useCallback(() => {
    setShowModelDialog(true);
  }, []);

  const closeModelDialog = useCallback(() => {
    setShowModelDialog(false);
  }, []);

  const handleModelSelection = useCallback(async (modelName: string) => {
    if (!config) {
      addMessage({
        type: MessageType.ERROR,
        content: 'Configuration not available',
        timestamp: new Date(),
      });
      return;
    }

    const currentModel = config.getModel();
    
    if (modelName === currentModel) {
      addMessage({
        type: MessageType.INFO,
        content: `Already using model: ${currentModel}`,
        timestamp: new Date(),
      });
      return;
    }

    try {
      // Update the model in config
      config.setModel(modelName);
      
      // Update the model in the Gemini client
      await config.getGeminiClient()?.updateModel(modelName);
      
      addMessage({
        type: MessageType.INFO,
        content: `Switched from ${currentModel} to ${modelName}`,
        timestamp: new Date(),
      });
    } catch (error) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      });
    }
  }, [config, addMessage]);

  return {
    showModelDialog,
    openModelDialog,
    closeModelDialog,
    handleModelSelection,
  };
};