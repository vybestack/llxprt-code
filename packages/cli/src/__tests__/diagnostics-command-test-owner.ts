/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandContext } from '../ui/commands/types.js';
import { createDiagnosticsCommand } from '../ui/commands/diagnosticsCommand.js';
import { bindDiagnosticsReads } from '../ui/commands/diagnosticsCommandHost.js';
export function registerDiagnosticsCommand(owner: CommandContext) {
  return createDiagnosticsCommand(
    bindDiagnosticsReads(
      owner.services.config,
      owner.services.settings,
      owner.services.agent,
      owner.runtimeApi,
      owner.oauthControl,
    ),
  );
}
