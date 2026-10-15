/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import type { IdeState } from '../ui/cliUiRuntime.js';
import { createPermissionsCommand } from '../ui/commands/permissionsCommand.js';
import { bindPermissionCommit } from '../ui/commands/permissionsCommandHost.js';
import { createIdeCommand } from '../ui/commands/ideCommand.js';
import { bindIdeCommand } from '../ui/commands/ideCommandHost.js';
export function registerPermissionsCommand(owner: CommandOwnerFixture) {
  return createPermissionsCommand(
    () => owner.services.config?.getWorkingDir() ?? process.cwd(),
    bindPermissionCommit(owner.services.config),
  );
}
export function registerIdeCommand(
  config: IdeState | null,
  owner: CommandOwnerFixture,
) {
  return createIdeCommand(
    bindIdeCommand(config, owner.services.settings, owner.ui.addItem),
  );
}
