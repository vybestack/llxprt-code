/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Command,
  CommandContext,
  CommandExecutionResponse,
} from './types.js';

export class ExtensionsCommand implements Command {
  readonly name = 'extensions';
  readonly description = 'Manage extensions.';
  readonly subCommands: Command[];
  readonly topLevel = true;

  constructor() {
    this.subCommands = [new ListExtensionsCommand()];
  }

  async execute(
    context: CommandContext,
    _: string[],
  ): Promise<CommandExecutionResponse> {
    return this.subCommands[0].execute(context, _);
  }
}

export class ListExtensionsCommand implements Command {
  readonly name = 'extensions list';
  readonly description = 'Lists all installed extensions.';

  async execute(
    context: CommandContext,
    _: string[],
  ): Promise<CommandExecutionResponse> {
    const extensions = context.extensions;
    const data =
      extensions.length > 0 ? extensions : 'No extensions installed.';

    return { name: this.name, data };
  }
}
