/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CommandModule } from 'yargs';
import { FatalConfigError, getErrorMessage } from '@vybestack/llxprt-code-core';
import {
  updateExtensionByName,
  updateAllUpdatableExtensions,
  type ExtensionUpdateInfo,
} from '../../config/extension.js';

interface UpdateArgs {
  name?: string;
  all?: boolean;
}

const updateOutput = (info: ExtensionUpdateInfo) =>
  `Extension "${info.name}" successfully updated: ${info.originalVersion} → ${info.updatedVersion}.`;

export async function handleUpdate(args: UpdateArgs) {
  if (args.all) {
    try {
      const updateInfos = await updateAllUpdatableExtensions();
      if (updateInfos.length === 0) {
        console.log('No extensions to update.');
        return;
      }
      console.log(updateInfos.map((info) => updateOutput(info)).join('\n'));
    } catch (error) {
      throw new FatalConfigError(getErrorMessage(error));
    }
    return;
  }
  if (args.name)
    try {
      // TODO(chrstnb): we should list extensions if the requested extension is not installed.
      const updatedExtensionInfo = await updateExtensionByName(args.name);
      if (updatedExtensionInfo) {
        console.log(updateOutput(updatedExtensionInfo));
      } else {
        console.log(`Extension "${args.name}" is already up to date.`);
      }
    } catch (error) {
      throw new FatalConfigError(getErrorMessage(error));
    }
}

export const updateCommand: CommandModule = {
  command: 'update [--all] [name]',
  describe:
    'Updates all extensions or a named extension to the latest version.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension to update.',
        type: 'string',
      })
      .option('all', {
        describe: 'Update all extensions.',
        type: 'boolean',
      })
      .conflicts('name', 'all')
      .check((argv) => {
        if (!argv.all && !argv.name) {
          throw new Error('Either an extension name or --all must be provided');
        }
        return true;
      }),
  handler: async (argv) => {
    await handleUpdate({
      name: argv['name'] as string | undefined,
      all: argv['all'] as boolean | undefined,
    });
  },
};
