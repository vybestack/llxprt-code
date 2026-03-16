/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { loadUserExtensions, toOutputString } from '../../config/extension.js';
import { getErrorMessage } from '../../utils/errors.js';
import { exitCli } from '../utils.js';

export async function handleList() {
  try {
    const extensions = loadUserExtensions();
    if (extensions.length === 0) {
      console.log('No extensions installed.');
      return;
    }
    console.log(
      extensions
        .map((extension, _): string => toOutputString(extension, process.cwd()))
        .join('\n\n'),
    );
  } catch (error) {
    console.error(getErrorMessage(error));
    await exitCli(1);
  }
}

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'Lists installed extensions.',
  builder: (yargs) => yargs,
  handler: async () => {
    await handleList();
    await exitCli();
  },
};
