/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { AppState } from '../reducers/appReducer.js';

interface UseCreateProfileDialogParams {
  appState: AppState;
}

export const useCreateProfileDialog = ({
  appState,
}: UseCreateProfileDialogParams) => {
  const appDispatch = useAppDispatch();
  const runtime = useRuntimeApi();
  const showDialog = appState.openDialogs.createProfile;
  const [providers, setProviders] = useState<string[]>([]);

  const openDialog = useCallback(() => {
    // Populate provider list from runtime
    try {
      const providerList = runtime.listProviders();
      setProviders(providerList);
    } catch (_e) {
      // Silently fail - wizard will fall back to static list
      setProviders([]);
    }
    appDispatch({ type: 'OPEN_DIALOG', payload: 'createProfile' });
  }, [appDispatch, runtime]);

  const closeDialog = useCallback(
    () => appDispatch({ type: 'CLOSE_DIALOG', payload: 'createProfile' }),
    [appDispatch],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    providers,
  };
};
