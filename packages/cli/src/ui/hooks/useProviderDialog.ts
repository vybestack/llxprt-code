/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { type AppState } from '../reducers/appReducer.js';
import { type RecordingIntegration } from '@vybestack/llxprt-code-core';
import { NO_ACTIVE_PROVIDER_ERROR_MESSAGE } from '@vybestack/llxprt-code-providers/runtime.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

interface UseProviderDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  onProviderChange?: () => void;
  appState: AppState;
  onClear?: () => void;
  recordingIntegration?: RecordingIntegration;
}

type AddMessage = UseProviderDialogParams['addMessage'];
type RuntimeApi = ReturnType<typeof useRuntimeApi>;
type ProviderSwitchResult = Awaited<ReturnType<RuntimeApi['setProvider']>>;

interface ProviderSwitchNotificationParams {
  addMessage: AddMessage;
  prevProvider: string;
  providerName: string;
  result: ProviderSwitchResult;
  runtime: RuntimeApi;
  recordingIntegration?: RecordingIntegration;
}

function notifyProviderSwitch({
  addMessage,
  prevProvider,
  providerName,
  result,
  runtime,
  recordingIntegration,
}: ProviderSwitchNotificationParams) {
  addMessage({
    type: MessageType.INFO,
    content: `Switched from ${prevProvider || 'none'} to ${providerName}`,
    timestamp: new Date(),
  });

  for (const info of result.infoMessages) {
    addMessage({
      type: MessageType.INFO,
      content: info,
      timestamp: new Date(),
    });
  }

  recordingIntegration?.recordProviderSwitch(
    result.nextProvider,
    result.defaultModel ?? runtime.getActiveModelName(),
  );
}

function addProviderError(
  addMessage: AddMessage,
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
function resolveActiveProviderName(runtime: RuntimeApi): string {
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
  onProviderChange,
  appState,
  onClear,
  recordingIntegration,
}: UseProviderDialogParams) => {
  const appDispatch = useAppDispatch();
  const runtime = useRuntimeApi();
  const showDialog = appState.openDialogs.provider;
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
    appDispatch({ type: 'OPEN_DIALOG', payload: 'provider' });
  }, [addMessage, appDispatch, runtime]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'provider' }),
    [appDispatch],
  );

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
        onClear?.();
        notifyProviderSwitch({
          addMessage,
          prevProvider: prev,
          providerName,
          result,
          runtime,
          recordingIntegration,
        });
        setCurrentProvider(result.nextProvider);
        onProviderChange?.();
      } catch (e) {
        addProviderError(addMessage, 'Failed to switch provider', e);
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
