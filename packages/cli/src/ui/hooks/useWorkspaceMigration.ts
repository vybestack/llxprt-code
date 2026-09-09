/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useCallback, useMemo } from 'react';
import { getWorkspaceExtensions } from '../../config/extension.js';
import { type LoadedSettings, SettingScope } from '../../config/settings.js';
import process from 'node:process';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

export function useWorkspaceMigration(
  settings: LoadedSettings,
  dialogs: DialogOpeners,
) {
  useEffect(() => {
    if (settings.merged.extensionManagement !== true) {
      return;
    }
    const cwd = process.cwd();
    const extensions = getWorkspaceExtensions(cwd);
    if (
      extensions.length > 0 &&
      settings.merged.extensions.workspacesWithMigrationNudge?.includes(cwd) !==
        true
    ) {
      dialogs.workspaceMigration.open({ extensions });
      debugLogger.log(JSON.stringify(settings.merged.extensions));
    }
  }, [
    settings.merged.extensions,
    settings.merged.extensionManagement,
    dialogs,
  ]);

  const onWorkspaceMigrationDialogOpen = useCallback(() => {
    const userSettings = settings.forScope(SettingScope.User);
    const extensionSettings = userSettings.settings.extensions ?? {
      disabled: [],
    };
    const workspacesWithMigrationNudge =
      extensionSettings.workspacesWithMigrationNudge ?? [];

    const cwd = process.cwd();
    if (!workspacesWithMigrationNudge.includes(cwd)) {
      workspacesWithMigrationNudge.push(cwd);
    }

    extensionSettings.workspacesWithMigrationNudge =
      workspacesWithMigrationNudge;
    settings.setValue(SettingScope.User, 'extensions', extensionSettings);
  }, [settings]);

  return useMemo(
    () => ({
      onWorkspaceMigrationDialogOpen,
    }),
    [onWorkspaceMigrationDialogOpen],
  );
}
