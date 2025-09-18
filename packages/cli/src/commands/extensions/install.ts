/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandModule } from 'yargs';
import {
  installExtension,
  ExtensionInstallMetadata,
} from '../../config/extension.js';
import {
  checkGitHubReleasesExist,
  parseGitHubRepoForReleases,
} from '../../config/extensions/github.js';

interface InstallArgs {
  source?: string;
  path?: string;
  ref?: string;
  autoUpdate?: boolean;
}

const ORG_REPO_REGEX = /^[a-zA-Z0-9-]+\/[\w.-]+$/;

export async function handleInstall(args: InstallArgs) {
  try {
    let installMetadata: ExtensionInstallMetadata;

    if (args.source) {
      const { source, ref } = args;
      const isSsoSource = source.startsWith('sso://');
      if (
        source.startsWith('http://') ||
        source.startsWith('https://') ||
        source.startsWith('git@') ||
        source.startsWith('sso://')
      ) {
        installMetadata = {
          source,
          type: 'git',
          ref: args.ref,
          autoUpdate: args.autoUpdate,
        };
        if (ref) {
          installMetadata.ref = ref;
        }
        if (isSsoSource) {
          console.warn(
            'sso:// URLs require a git-remote-sso helper or protocol remapping. ' +
              'Ensure your environment provides a git transport for sso:// before continuing.',
          );
        }
      } else if (ORG_REPO_REGEX.test(source)) {
        // For org/repo format, try github-release first, fall back to git
        const { owner, repo } = parseGitHubRepoForReleases(source);
        let useGitHubRelease = false;

        try {
          useGitHubRelease = await checkGitHubReleasesExist(owner, repo);
        } catch {
          // Fall back to git clone if we can't check for releases
          useGitHubRelease = false;
        }

        if (useGitHubRelease) {
          installMetadata = {
            source,
            type: 'github-release',
          };
        } else {
          installMetadata = {
            source: `https://github.com/${source}.git`,
            type: 'git',
          };
        }

        if (ref) {
          installMetadata.ref = ref;
        }
      } else {
        throw new Error(
          `The source "${source}" is not a valid URL or "org/repo" format.`,
        );
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

    const extensionName = await installExtension(installMetadata);
    console.log(
      `Extension "${extensionName}" installed successfully and enabled.`,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

export const installCommand: CommandModule = {
  command: 'install [<source>] [--path] [--ref] [--auto-update]',
  describe:
    'Installs an extension from a git repository (URL or "org/repo") or a local path.',
  builder: (yargs) =>
    yargs
      .option('source', {
        describe: 'The git URL or "org/repo" of the extension to install.',
        type: 'string',
      })
      .option('path', {
        describe: 'Path to a local extension directory.',
        type: 'string',
      })
      .option('ref', {
        describe:
          'Git branch/tag or GitHub release tag to install from (default: latest).',
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
