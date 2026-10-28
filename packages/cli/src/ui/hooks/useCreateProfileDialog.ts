/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useListProviders } from '../contexts/RuntimeContext.js';

import { useCallback, useState } from 'react';

import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

interface UseCreateProfileDialogParams {
  dialogs: DialogOpeners;
}

export const useCreateProfileDialog = ({
  dialogs,
}: UseCreateProfileDialogParams) => {
  const runtimeListProviders = useListProviders();
  const [providers, setProviders] = useState<string[]>([]);

  const openDialog = useCallback(() => {
    // Populate provider list from runtime
    try {
      const providerList = runtimeListProviders();
      setProviders(providerList);
    } catch {
      // Silently fail - wizard will fall back to static list
      setProviders([]);
    }
    dialogs.createProfile.open({});
  }, [dialogs, runtimeListProviders]);

  return {
    openDialog,
    providers,
  };
};
