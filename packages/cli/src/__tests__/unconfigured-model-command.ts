/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createModelCommand } from '../ui/commands/modelCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';

export function createUnconfiguredModelCommand(): SlashCommand {
  return createModelCommand(
    async () => {
      throw new Error(
        'Model selection is unavailable in this registry fixture',
      );
    },
    async () => {
      throw new Error('Recording is unavailable in this registry fixture');
    },
  );
}
