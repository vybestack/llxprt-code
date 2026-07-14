/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { getWorkspaceExtensions } from '../../config/extension.js';
import { type LoadedSettings, SettingScope } from '../../config/settings.js';
import process from 'node:process';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

export function useWorkspaceMigration(settings: LoadedSettings) {
  const [showWorkspaceMigrationDialog, setShowWorkspaceMigrationDialog] =
    useState(false);
  const [workspaceExtensions, setWorkspaceExtensions] = useState<
    LlxprtExtension[]
  >([]);

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
      setWorkspaceExtensions(extensions);
      setShowWorkspaceMigrationDialog(true);
      debugLogger.log(JSON.stringify(settings.merged.extensions));
    }
  }, [settings.merged.extensions, settings.merged.extensionManagement]);

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

  const onWorkspaceMigrationDialogClose = useCallback(() => {
    setShowWorkspaceMigrationDialog(false);
  }, [setShowWorkspaceMigrationDialog]);

  return useMemo(
    () => ({
      showWorkspaceMigrationDialog,
      workspaceLlxprtExtensions: workspaceExtensions,
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
