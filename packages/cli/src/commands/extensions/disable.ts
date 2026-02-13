/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CommandModule } from 'yargs';
import { FatalConfigError, getErrorMessage } from '@vybestack/llxprt-code-core';
import { disableExtension } from '../../config/extension.js';
import { SettingScope } from '../../config/settings.js';
import { exitCli } from '../utils.js';

interface DisableArgs {
  name: string;
  scope?: string;
}

export async function handleDisable(args: DisableArgs) {
  try {
    const scope =
      args.scope?.toLowerCase() === 'workspace'
        ? SettingScope.Workspace
        : SettingScope.User;
    disableExtension(args.name, scope);
    console.log(
      `Extension "${args.name}" successfully disabled for scope "${scope}".`,
    );
  } catch (error) {
    throw new FatalConfigError(getErrorMessage(error));
  }
}

export const disableCommand: CommandModule = {
  command: 'disable [--scope] <name>',
  describe: 'Disables an extension.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension to disable.',
        type: 'string',
      })
      .option('scope', {
        describe:
          'The scope to disable the extension in. Defaults to user scope.',
        type: 'string',
        default: SettingScope.User,
      })
      .check((argv) => {
        if (
          argv.scope &&
          !Object.values(SettingScope)
            .map((s) => s.toLowerCase())
            .includes((argv.scope as string).toLowerCase())
        ) {
          throw new Error(
            `Invalid scope: ${argv.scope}. Please use one of ${Object.values(
              SettingScope,
            )
              .map((s) => s.toLowerCase())
              .join(', ')}.`,
          );
        }
        return true;
      }),
  handler: async (argv) => {
    await handleDisable({
      name: argv['name'] as string,
      scope: argv['scope'] as string,
    });
    await exitCli();
  },
};
