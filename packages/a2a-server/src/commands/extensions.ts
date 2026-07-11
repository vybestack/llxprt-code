/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { listExtensions } from '@vybestack/llxprt-code-core';
import type {
  Command,
  CommandContext,
  CommandExecutionResponse,
} from './types.js';

type ListExtensions = typeof listExtensions;

export class ExtensionsCommand implements Command {
  readonly name = 'extensions';
  readonly description = 'Manage extensions.';
  readonly subCommands: Command[];
  readonly topLevel = true;

  constructor(listInstalledExtensions: ListExtensions = listExtensions) {
    this.subCommands = [new ListExtensionsCommand(listInstalledExtensions)];
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

  constructor(
    private readonly listInstalledExtensions: ListExtensions = listExtensions,
  ) {}

  async execute(
    context: CommandContext,
    _: string[],
  ): Promise<CommandExecutionResponse> {
    const extensions = this.listInstalledExtensions(context.config);
    const data =
      extensions.length > 0 ? extensions : 'No extensions installed.';

    return { name: this.name, data };
  }
}
