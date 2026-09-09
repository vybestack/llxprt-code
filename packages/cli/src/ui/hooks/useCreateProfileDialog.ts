/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';

interface UseCreateProfileDialogParams {
  store: DialogStore;
  dialogs: DialogOpeners;
}

export const useCreateProfileDialog = ({
  store,
  dialogs,
}: UseCreateProfileDialogParams) => {
  const runtime = useRuntimeApi();
  const showDialog = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'createProfile'),
  );
  const [providers, setProviders] = useState<string[]>([]);

  const openDialog = useCallback(() => {
    // Populate provider list from runtime
    try {
      const providerList = runtime.listProviders();
      setProviders(providerList);
    } catch {
      // Silently fail - wizard will fall back to static list
      setProviders([]);
    }
    dialogs.createProfile.open({});
  }, [dialogs, runtime]);

  const closeDialog = useCallback(
    () => dialogs.createProfile.close(),
    [dialogs],
  );

  return {
    showDialog,
    openDialog,
    closeDialog,
    providers,
  };
};
