/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import { createDiagnosticsCommand } from '../ui/commands/diagnosticsCommand.js';
import { bindDiagnosticsReads } from '../ui/commands/diagnosticsCommandHost.js';
export function registerDiagnosticsCommand(owner: CommandOwnerFixture) {
  return createDiagnosticsCommand(
    bindDiagnosticsReads(
      owner.services.config,
      owner.services.settings,
      () => {
        const agent = owner.services.agent;
        if (agent === null) throw new Error('agent not available');
        return agent.tools.list();
      },
      owner.runtimeApi,
      owner.oauthControl,
    ),
  );
}
