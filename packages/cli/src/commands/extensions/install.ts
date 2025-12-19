/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import {
  installOrUpdateExtension,
  requestConsentNonInteractive,
} from '../../config/extension.js';
import type { ExtensionInstallMetadata } from '@vybestack/llxprt-code-core';
import {
  checkGitHubReleasesExist,
  parseGitHubRepoForReleases,
} from '../../config/extensions/github.js';

import { getErrorMessage } from '../../utils/errors.js';

interface InstallArgs {
  source?: string;
  path?: string;
  ref?: string;
  autoUpdate?: boolean;
}

export async function handleInstall(args: InstallArgs) {
  try {
    let installMetadata: ExtensionInstallMetadata;
    if (args.source) {
      const { source } = args;
      if (
        source.startsWith('http://') ||
        source.startsWith('https://') ||
        source.startsWith('git@')
      ) {
        installMetadata = {
          source,
          type: 'git',
          ref: args.ref,
          autoUpdate: args.autoUpdate,
        };
      } else if (source.startsWith('sso://')) {
        console.warn(
          'sso:// URLs require a git-remote-sso helper to be installed. See https://github.com/google/git-remote-sso for more information.',
        );
        installMetadata = {
          source,
          type: 'git',
          ref: args.ref,
          autoUpdate: args.autoUpdate,
        };
      } else {
        // Try to parse as org/repo format
        try {
          const { owner, repo } = parseGitHubRepoForReleases(source);
          // Check if releases exist
          let hasReleases = false;
          try {
            hasReleases = await checkGitHubReleasesExist(owner, repo);
          } catch {
            // If check fails, fall back to git
            hasReleases = false;
          }

          if (hasReleases) {
            installMetadata = {
              source,
              type: 'github-release',
              ref: args.ref,
              autoUpdate: args.autoUpdate,
            };
          } else {
            // Fall back to git clone
            installMetadata = {
              source: `https://github.com/${owner}/${repo}.git`,
              type: 'git',
              ref: args.ref,
              autoUpdate: args.autoUpdate,
            };
          }
        } catch {
          throw new Error(
            `The source "${source}" is not a valid URL or "org/repo" format.`,
          );
        }
      }
    } else if (args.path) {
      installMetadata = {
        source: args.path,
        type: 'local',
        autoUpdate: args.autoUpdate,
      };
    } else {
      // This should not be reached due to the yargs check.
      throw new Error('Either --source or --path must be provided.');
    }

    const name = await installOrUpdateExtension(
      installMetadata,
      requestConsentNonInteractive,
    );
    console.log(`Extension "${name}" installed successfully and enabled.`);
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exit(1);
  }
}

export const installCommand: CommandModule = {
  command: 'install [<source>] [--path] [--ref] [--auto-update]',
  describe: 'Installs an extension from a git repository URL or a local path.',
  builder: (yargs) =>
    yargs
      .positional('source', {
        describe: 'The git repository URL of the extension to install.',
        type: 'string',
      })
      .option('path', {
        describe: 'Path to a local extension directory.',
        type: 'string',
      })
      .option('ref', {
        describe: 'The git ref to install from.',
        type: 'string',
      })
      .option('auto-update', {
        describe: 'Enable auto-update for this extension.',
        type: 'boolean',
      })
      .conflicts('source', 'path')
      .conflicts('path', 'ref')
      .conflicts('path', 'auto-update')
      .check((argv) => {
        if (!argv.source && !argv.path) {
          throw new Error('Either --source or --path must be provided.');
        }
        return true;
      }),
  handler: async (argv) => {
    await handleInstall({
      source: argv['source'] as string | undefined,
      path: argv['path'] as string | undefined,
      ref: argv['ref'] as string | undefined,
      autoUpdate: argv['auto-update'] as boolean | undefined,
    });
  },
};
