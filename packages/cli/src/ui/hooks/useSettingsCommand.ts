/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

export function useSettingsCommand(dialogs: DialogOpeners) {
  const openSettingsDialog = useCallback(() => {
    dialogs.settings.open({});
  }, [dialogs]);

  const closeSettingsDialog = useCallback(() => {
    dialogs.settings.close();
  }, [dialogs]);

  return {
    openSettingsDialog,
    closeSettingsDialog,
  };
}
