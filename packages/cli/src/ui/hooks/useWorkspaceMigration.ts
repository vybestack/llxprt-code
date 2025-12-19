/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import { getWorkspaceExtensions } from '../../config/extension.js';
import { type LoadedSettings, SettingScope } from '../../config/settings.js';
import process from 'node:process';

export function useWorkspaceMigration(settings: LoadedSettings) {
  const [showWorkspaceMigrationDialog, setShowWorkspaceMigrationDialog] =
    useState(false);
  const [workspaceExtensions, setWorkspaceExtensions] = useState<
    GeminiCLIExtension[]
  >([]);

  useEffect(() => {
    if (!settings.merged.extensionManagement) {
      return;
    }
    const cwd = process.cwd();
    const extensions = getWorkspaceExtensions(cwd);
    if (
      extensions.length > 0 &&
      !settings.merged.extensions?.workspacesWithMigrationNudge?.includes(cwd)
    ) {
      setWorkspaceExtensions(extensions);
      setShowWorkspaceMigrationDialog(true);
      console.log(settings.merged.extensions);
    }
  }, [settings.merged.extensions, settings.merged.extensionManagement]);

  const onWorkspaceMigrationDialogOpen = useCallback(() => {
    const userSettings = settings.forScope(SettingScope.User);
    const extensionSettings = userSettings.settings.extensions || {
      disabled: [],
    };
    const workspacesWithMigrationNudge =
      extensionSettings.workspacesWithMigrationNudge || [];

    const cwd = process.cwd();
    if (!workspacesWithMigrationNudge.includes(cwd)) {
      workspacesWithMigrationNudge.push(cwd);
    }

    extensionSettings.workspacesWithMigrationNudge =
      workspacesWithMigrationNudge;
    settings.setValue(SettingScope.User, 'extensions', extensionSettings);
  }, [settings]);

  const onWorkspaceMigrationDialogClose = useCallback(() => {
    setShowWorkspaceMigrationDialog(false);
  }, [setShowWorkspaceMigrationDialog]);

  return useMemo(
    () => ({
      showWorkspaceMigrationDialog,
      workspaceGeminiCLIExtensions: workspaceExtensions,
      onWorkspaceMigrationDialogOpen,
      onWorkspaceMigrationDialogClose,
    }),
    [
      showWorkspaceMigrationDialog,
      workspaceExtensions,
      onWorkspaceMigrationDialogOpen,
      onWorkspaceMigrationDialogClose,
    ],
  );
}
