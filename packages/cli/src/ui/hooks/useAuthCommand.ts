/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type { LoadedSettings, SettingScope } from '../../config/settings.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

export const useAuthCommand = (
  settings: LoadedSettings,
  dialogs: DialogOpeners,
  setAuthError: (error: string | null) => void,
) => {
  const appDispatch = useAppDispatch();

  const openAuthDialog = useCallback(() => {
    dialogs.auth.open({});
  }, [dialogs]);

  const handleAuthSelect = useCallback(
    async (selection: string | undefined, _scope: SettingScope) => {
      dialogs.auth.close();
      if (selection === undefined) return;

      setAuthError(null);
      appDispatch({ type: 'SET_AUTH_ERROR', payload: null });
    },
    [dialogs, appDispatch, setAuthError],
  );

  return {
    openAuthDialog,
    handleAuthSelect,
  };
};
