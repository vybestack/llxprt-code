/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CommandModule } from 'yargs';
import { FatalConfigError, getErrorMessage } from '@vybestack/llxprt-code-core';
import { updateExtension } from '../../config/extension.js';

interface UpdateArgs {
  name: string;
}

export async function handleUpdate(args: UpdateArgs) {
  try {
    const result = await updateExtension(args.name);
    if (result) {
      console.log(
        `Extension "${args.name}" successfully updated from version ${result.originalVersion} to ${result.updatedVersion}.`,
      );
    } else {
      console.log(`Extension "${args.name}" is already up to date.`);
    }
  } catch (error) {
    throw new FatalConfigError(getErrorMessage(error));
  }
}

export const updateCommand: CommandModule = {
  command: 'update <name>',
  describe: 'Updates an extension to the latest version.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension to update.',
        type: 'string',
      })
      .check((_argv) => true),
  handler: async (argv) => {
    await handleUpdate({
      name: argv['name'] as string,
    });
  },
};