/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import {
  requestConsentNonInteractive,
  installOrUpdateExtension,
  loadExtensionByName,
  type ExtensionInstallMetadata,
} from '../../config/extension.js';

import { getErrorMessage } from '../../utils/errors.js';
import { exitCli } from '../utils.js';

interface InstallArgs {
  path: string;
  consent?: boolean;
}

export async function handleLink(args: InstallArgs) {
  try {
    const installMetadata: ExtensionInstallMetadata = {
      source: args.path,
      type: 'link',
    };
    const requestConsent = args.consent
      ? () => Promise.resolve(true)
      : requestConsentNonInteractive;
    const workspaceDir = process.cwd();
    const extensionName = await installOrUpdateExtension(
      installMetadata,
      requestConsent,
      workspaceDir,
    );
    const extension = loadExtensionByName(extensionName, workspaceDir);
    console.log(
      `Extension "${extension?.name ?? extensionName}" linked successfully and enabled.`,
    );
  } catch (error) {
    console.error(getErrorMessage(error));
    await exitCli(1);
  }
}

export const linkCommand: CommandModule = {
  command: 'link <path>',
  describe:
    'Links an extension from a local path. Updates made to the local path will always be reflected.',
  builder: (yargs) =>
    yargs
      .positional('path', {
        describe: 'The name of the extension to link.',
        type: 'string',
      })
      .option('consent', {
        describe:
          'Acknowledge the security risks of installing an extension and skip the confirmation prompt.',
        type: 'boolean',
        default: false,
      })
      .check((_) => true),
  handler: async (argv) => {
    await handleLink({
      path: argv['path'] as string,
      consent: argv['consent'] as boolean | undefined,
    });
    await exitCli();
  },
};
