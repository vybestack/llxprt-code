/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { createIdeCommand } from '../commands/ideCommand.js';
import { bindIdeCommand } from '../commands/ideCommandHost.js';
import { createPermissionsCommand } from '../commands/permissionsCommand.js';
import { bindPermissionCommit } from '../commands/permissionsCommandHost.js';
export function useHostCommands(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
) {
  const ideCommand = useMemo(
    () => createIdeCommand(bindIdeCommand(config, settings, addItem)),
    [config, settings, addItem],
  );
  const permissionsCommand = useMemo(
    () =>
      createPermissionsCommand(
        () => config?.getWorkingDir() ?? process.cwd(),
        bindPermissionCommit(config),
      ),
    [config],
  );
  return useMemo(
    () => ({ ideCommand, permissionsCommand }),
    [ideCommand, permissionsCommand],
  );
}
