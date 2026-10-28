/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import {
  NO_ACTIVE_PROVIDER_ERROR_MESSAGE,
  type AgentProviderSwitchResult,
} from '@vybestack/llxprt-code-agents';

interface UseProviderDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  listProviders: () => string[];
  getActiveProviderName: () => string;
  setProvider: (name: string) => Promise<AgentProviderSwitchResult>;
  getActiveModelName: () => string;
  recordProviderSwitch: (
    provider: string,
    model: string,
  ) => void | Promise<void>;
  openProviderDialog: () => void;
  closeProviderDialog: () => void;
}

function addProviderError(
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void,
  message: string,
  error: unknown,
) {
  addMessage({
    type: MessageType.ERROR,
    content: `${message}: ${error instanceof Error ? error.message : String(error)}`,
    timestamp: new Date(),
  });
}

function isNoActiveProviderSignal(error: unknown): boolean {
  return (
    error instanceof Error && error.message === NO_ACTIVE_PROVIDER_ERROR_MESSAGE
  );
}

/**
 * Resolves the active provider name for selector state. Only the documented
 * empty-state signal thrown by getActiveProviderName() is treated as "no
 * selection"; any other runtime failure propagates so callers can report it.
 */
function resolveActiveProviderName(
  getActiveProviderName: () => string,
): string {
  try {
    return getActiveProviderName();
  } catch (e) {
    if (isNoActiveProviderSignal(e)) {
      return '';
    }
    throw e;
  }
}

export const useProviderDialog = ({
  addMessage,
  listProviders,
  getActiveProviderName,
  setProvider,
  getActiveModelName,
  recordProviderSwitch,
  openProviderDialog,
  closeProviderDialog,
}: UseProviderDialogParams) => {
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');

  const openDialog = useCallback(() => {
    let loadedProviders: string[];
    let activeProvider: string;
    try {
      loadedProviders = listProviders();
      activeProvider = resolveActiveProviderName(getActiveProviderName);
    } catch (e) {
      addProviderError(addMessage, 'Failed to load providers', e);
      return;
    }
    setProviders(loadedProviders);
    setCurrentProvider(activeProvider);
    openProviderDialog();
  }, [addMessage, openProviderDialog, listProviders, getActiveProviderName]);

  const handleSelect = useCallback(
    async (providerName: string) => {
      try {
        const prev = resolveActiveProviderName(getActiveProviderName);
        /**
         * @plan:PLAN-20250218-STATELESSPROVIDER.P06
         * @requirement:REQ-SP-005
         * @pseudocode:cli-runtime.md line 9
         */
        const result = await setProvider(providerName);
        const model = result.defaultModel ?? getActiveModelName();
        await recordProviderSwitch(result.nextProvider, model);
        notifyProviderSwitch({
          addMessage,
          prevProvider: prev,
          infoMessages: result.infoMessages,
          providerName: result.nextProvider,
        });
        setCurrentProvider(result.nextProvider);
      } catch (e) {
        addProviderError(addMessage, 'Failed to switch provider', e);
      }
      closeProviderDialog();
    },
    [
      addMessage,
      closeProviderDialog,
      getActiveProviderName,
      setProvider,
      getActiveModelName,
      recordProviderSwitch,
    ],
  );

  return {
    openDialog,
    providers,
    currentProvider,
    handleSelect,
  };
};

function notifyProviderSwitch({
  addMessage,
  prevProvider,
  providerName,
  infoMessages,
}: {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  infoMessages: readonly string[];
  prevProvider: string;
  providerName: string;
}) {
  const from = prevProvider || 'none';
  addMessage({
    type: MessageType.INFO,
    content: `Switched from ${from} to ${providerName}`,
    timestamp: new Date(),
  });
  for (const content of infoMessages) {
    addMessage({ type: MessageType.INFO, content, timestamp: new Date() });
  }
}
