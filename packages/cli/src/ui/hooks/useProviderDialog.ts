/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { getProviderManager } from '../../providers/providerManagerInstance.js';
import { MessageType } from '../types.js';

interface UseProviderDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  onProviderChange?: () => void;
}

export const useProviderDialog = ({
  addMessage,
  onProviderChange,
}: UseProviderDialogParams) => {
  const [showDialog, setShowDialog] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');

  const openDialog = useCallback(() => {
    try {
      const providerManager = getProviderManager();
      setProviders(providerManager.listProviders());
      setCurrentProvider(providerManager.getActiveProviderName());
      setShowDialog(true);
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load providers: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage]);

  const closeDialog = useCallback(() => setShowDialog(false), []);

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
      setShowDialog(false);
    },
    [addMessage, onProviderChange],
  );

  return { showDialog, openDialog, closeDialog, providers, currentProvider, handleSelect };
};
