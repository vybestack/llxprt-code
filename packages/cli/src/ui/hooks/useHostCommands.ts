/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSetupGithubCommand } from '../commands/setupGithubCommand.js';
import { bindGithubSetup } from '../commands/setupGithubCommandHost.js';
import { useMemo, useEffect, useReducer } from 'react';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommand } from '../commands/types.js';
import { createPermissionsCommand } from '../commands/permissionsCommand.js';
import { bindPermissionCommit } from '../commands/permissionsCommandHost.js';
export function useHostCommands(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  registerIdeCommand: (
    addItem: UseHistoryManagerReturn['addItem'],
  ) => SlashCommand | null,
  subscribeCommandChanges: (listener: () => void) => (() => void) | undefined,
) {
  const [, refreshConnection] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  useEffect(
    () => subscribeCommandChanges(refreshConnection),
    [subscribeCommandChanges],
  );
  const ideCommand = registerIdeCommand(addItem);
  const permissionsCommand = useMemo(
    () =>
      createPermissionsCommand(
        () => config?.getWorkingDir() ?? process.cwd(),
        bindPermissionCommit(config),
      ),
    [config],
  );
  const setupGithubCommand = useMemo(
    () =>
      createSetupGithubCommand(
        bindGithubSetup(
          config?.getWorkingDir() ?? process.cwd(),
          config?.getProxy(),
        ),
      ),
    [config],
  );
  return useMemo(
    () => ({ ideCommand, permissionsCommand, setupGithubCommand }),
    [ideCommand, permissionsCommand, setupGithubCommand],
  );
}
