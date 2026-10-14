/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindProfileCommandOperations } from '../profileCommandHost.js';
import { createProfileCommand } from '../profileCommand.js';
import type { CommandContext, SlashCommand } from '../types.js';

export function createProfileCommandForTest(
  context: CommandContext,
  recordProviderSwitch: (
    provider: string,
    model: string,
  ) => void | Promise<void> = async () => {},
): SlashCommand {
  return createProfileCommand(
    bindProfileCommandOperations({
      agent: context.services.agent,
      runtimeApi: context.runtimeApi,
      settings: context.services.settings,
      oauthControl: context.oauthControl,
      recordProviderSwitch,
    }),
  );
}
