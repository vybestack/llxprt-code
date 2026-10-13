/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createModelCommand } from '../ui/commands/modelCommand.js';
import type { SlashCommand } from '../ui/commands/types.js';

import { createToolFormatCommand } from '../ui/commands/toolformatCommand.js';
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

export function createUnconfiguredToolFormatCommand(): SlashCommand {
  return createToolFormatCommand(
    async () => {
      throw new Error(
        'Tool-format reads are unavailable in this registry fixture',
      );
    },
    async () => {
      throw new Error(
        'Tool-format writes are unavailable in this registry fixture',
      );
    },
  );
}
