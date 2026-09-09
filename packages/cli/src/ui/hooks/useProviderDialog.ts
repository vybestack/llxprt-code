/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { type RecordingIntegration } from '@vybestack/llxprt-code-core';
import { NO_ACTIVE_PROVIDER_ERROR_MESSAGE } from '@vybestack/llxprt-code-providers/runtime.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

interface UseProviderDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  store: DialogStore;
  dialogs: DialogOpeners;
  recordingIntegration?: RecordingIntegration;
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
  runtime: ReturnType<typeof useRuntimeApi>,
): string {
  try {
    return runtime.getActiveProviderName();
  } catch (e) {
    if (isNoActiveProviderSignal(e)) {
      return '';
    }
    throw e;
  }
}

export const useProviderDialog = ({
  addMessage,
  store,
  dialogs,
  recordingIntegration,
}: UseProviderDialogParams) => {
  const runtime = useRuntimeApi();
  const showDialog = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'provider'),
  );
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');

  const openDialog = useCallback(() => {
    let loadedProviders: string[];
    let activeProvider: string;
    try {
      loadedProviders = runtime.listProviders();
      activeProvider = resolveActiveProviderName(runtime);
    } catch (e) {
      addProviderError(addMessage, 'Failed to load providers', e);
      return;
    }
    setProviders(loadedProviders);
    setCurrentProvider(activeProvider);
    dialogs.provider.open({});
  }, [addMessage, dialogs, runtime]);

  const closeDialog = useCallback(() => dialogs.provider.close(), [dialogs]);

  const handleSelect = useCallback(
    async (providerName: string) => {
      try {
        const prev = resolveActiveProviderName(runtime);
        /**
         * @plan:PLAN-20250218-STATELESSPROVIDER.P06
         * @requirement:REQ-SP-005
         * @pseudocode:cli-runtime.md line 9
         */
        const result = await runtime.setProvider(providerName);
        recordingIntegration?.recordProviderSwitch(
          result.nextProvider,
          result.defaultModel ?? runtime.getActiveModelName(),
        );
        notifyProviderSwitch({
          addMessage,
          prevProvider: prev,
          providerName,
        });
        setCurrentProvider(result.nextProvider);
      } catch (e) {
        addProviderError(addMessage, 'Failed to switch provider', e);
      }
      dialogs.provider.close();
    },
    [addMessage, dialogs, runtime, recordingIntegration],
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

function notifyProviderSwitch({
  addMessage,
  prevProvider,
  providerName,
}: {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  prevProvider: string;
  providerName: string;
}) {
  const from = prevProvider || 'none';
  addMessage({
    type: MessageType.INFO,
    content: `Switched from ${from} to ${providerName}`,
    timestamp: new Date(),
  });
}
