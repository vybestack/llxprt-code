/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import type { IdeCommandOperations } from '../ui/commands/ideCommand.js';
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
  config: IdeCommandOperations | null,
  owner: CommandOwnerFixture,
) {
  return createIdeCommand(
    config === null
      ? null
      : bindIdeCommand(
          config.readConnection,
          config.readContext,
          config.setIdeMode,
          config.connect,
          config.disconnect,
          owner.services.settings,
          owner.ui.addItem,
        ),
  );
}
