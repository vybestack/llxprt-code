/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandModule } from 'yargs';
import { uninstallExtension } from '../../config/extension.js';
import { exitCli } from '../utils.js';

interface UninstallArgs {
  names: string[];
}

export async function handleUninstall(args: UninstallArgs): Promise<void> {
  const uniqueNames = [...new Set(args.names)];

  if (uniqueNames.length === 0) {
    console.error('No valid extension names provided to uninstall.');
    await exitCli(1);
    return;
  }

  const errors: Array<{ name: string; error: string }> = [];

  for (const name of uniqueNames) {
    try {
      await uninstallExtension(name, false);
      console.log(`Extension "${name}" successfully uninstalled.`);
    } catch (error) {
      errors.push({ name, error: (error as Error).message });
    }
  }

  if (errors.length > 0) {
    for (const { name, error } of errors) {
      console.error(`Failed to uninstall "${name}": ${error}`);
    }
    await exitCli(1);
  }
}

export const uninstallCommand: CommandModule = {
  command: 'uninstall <names..>',
  describe: 'Uninstalls one or more extensions.',
  builder: (yargs) =>
    yargs
      .positional('names', {
        describe: 'The names or source paths of the extensions to uninstall.',
        type: 'string',
        array: true,
      })
      .check((argv) => {
        if (!argv.names || argv.names.length === 0) {
          throw new Error(
            'Please include at least one extension name to uninstall.',
          );
        }
        return true;
      }),
  handler: async (argv) => {
    await handleUninstall({
      names: argv['names'] as string[],
    });
    await exitCli();
  },
};
