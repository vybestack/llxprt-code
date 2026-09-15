/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import {
  listImageProviders,
  pinImageProvider,
} from '../commands/providerSelection.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { AppState } from '../reducers/appReducer.js';
import { MessageType } from '../types.js';

interface UseImageProviderDialogParams {
  settings: LoadedSettings;
  appState: AppState;
  addMessage: (message: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
}

interface ImageProviderDialogState {
  showDialog: boolean;
  providers: string[];
  currentProvider: string;
  openDialog: () => void;
  closeDialog: () => void;
  handleSelect: (alias: string) => void;
}

export function useImageProviderDialog({
  settings,
  appState,
  addMessage,
}: UseImageProviderDialogParams): ImageProviderDialogState {
  const dispatch = useAppDispatch();
  const runtime = useRuntimeApi();
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState('');
  const closeDialog = useCallback(
    () => dispatch({ type: 'CLOSE_DIALOG', payload: 'imageProvider' }),
    [dispatch],
  );
  const reportError = useCallback(
    (error: unknown) => {
      addMessage({
        type: MessageType.ERROR,
        content: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      });
    },
    [addMessage],
  );
  const openDialog = useCallback(() => {
    try {
      setProviders(listImageProviders());
      setCurrentProvider(
        settings.merged.imageProvider ?? runtime.getActiveProviderName(),
      );
      dispatch({ type: 'OPEN_DIALOG', payload: 'imageProvider' });
    } catch (error) {
      reportError(error);
      closeDialog();
    }
  }, [settings, runtime, dispatch, reportError, closeDialog]);
  const handleSelect = useCallback(
    (alias: string) => {
      try {
        pinImageProvider(settings, runtime, alias);
        addMessage({
          type: MessageType.INFO,
          content: `Image provider set to ${alias}`,
          timestamp: new Date(),
        });
      } catch (error) {
        reportError(error);
      } finally {
        closeDialog();
      }
    },
    [settings, runtime, addMessage, reportError, closeDialog],
  );
  return {
    showDialog: appState.openDialogs.imageProvider,
    providers,
    currentProvider,
    openDialog,
    closeDialog,
    handleSelect,
  };
}
