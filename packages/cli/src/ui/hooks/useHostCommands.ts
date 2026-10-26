/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createSetupGithubCommand } from '../commands/setupGithubCommand.js';
import { bindGithubSetup } from '../commands/setupGithubCommandHost.js';
import { useMemo, useEffect, useReducer } from 'react';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommand } from '../commands/types.js';
import { createPermissionsCommand } from '../commands/permissionsCommand.js';
import {
  bindPermissionCommit,
  type PermissionsTrustRuntime,
} from '../commands/permissionsCommandHost.js';

/**
 * The workspace and proxy reads the host (IDE/trust/GitHub) commands need.
 */
export interface HostCommandsRuntime {
  getWorkingDir(): string;
  getProxy(): string | undefined;
}

export function useHostCommands(
  runtime: HostCommandsRuntime | null,
  trust: PermissionsTrustRuntime | null,
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
        () => runtime?.getWorkingDir() ?? process.cwd(),
        bindPermissionCommit(trust),
      ),
    [runtime, trust],
  );
  const setupGithubCommand = useMemo(
    () =>
      createSetupGithubCommand(
        bindGithubSetup(
          runtime?.getWorkingDir() ?? process.cwd(),
          runtime?.getProxy(),
        ),
      ),
    [runtime],
  );
  return useMemo(
    () => ({ ideCommand, permissionsCommand, setupGithubCommand }),
    [ideCommand, permissionsCommand, setupGithubCommand],
  );
}
