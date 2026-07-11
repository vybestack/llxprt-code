/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExtensionsCommand } from './extensions.js';
import { RestoreCommand } from './restore.js';
import { InitCommand } from './init.js';
import type { Command } from './types.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  constructor(
    commands: Command[] = [
      new ExtensionsCommand(),
      new RestoreCommand(),
      new InitCommand(),
    ],
    private readonly warn: (message: string) => void = (message) =>
      debugLogger.warn(message),
  ) {
    for (const command of commands) {
      this.register(command);
    }
  }

  register(command: Command) {
    if (this.commands.has(command.name)) {
      this.warn(`Command ${command.name} already registered. Skipping.`);
      return;
    }

    this.commands.set(command.name, command);

    for (const subCommand of command.subCommands ?? []) {
      this.register(subCommand);
    }
  }

  get(commandName: string): Command | undefined {
    return this.commands.get(commandName);
  }

  getAllCommands(): Command[] {
    return [...this.commands.values()];
  }
}

export const commandRegistry = new CommandRegistry();
