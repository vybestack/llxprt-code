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
import {
  checkGitHubReleasesExist,
  parseGitHubRepoForReleases,
} from '../../config/extensions/github.js';

import { getErrorMessage } from '../../utils/errors.js';
import * as fs from 'node:fs/promises';
import { exitCli } from '../utils.js';

interface InstallArgs {
  source?: string;
  path?: string;
  ref?: string;
  autoUpdate?: boolean;
}

export async function handleInstall(args: InstallArgs) {
  try {
    const installMetadata = await resolveInstallMetadata(args);
    if (!installMetadata) {
      return;
    }

    const workspaceDir = process.cwd();
    const extensionName = await installOrUpdateExtension(
      installMetadata,
      requestConsentNonInteractive,
      workspaceDir,
    );
    const extension = loadExtensionByName(extensionName, workspaceDir);
    console.log(
      `Extension "${extension?.name ?? extensionName}" installed successfully and enabled.`,
    );
  } catch (error) {
    console.error(getErrorMessage(error));
    await exitCli(1);
  }
}

/**
 * Resolves the install metadata based on the provided arguments.
 */
async function resolveInstallMetadata(
  args: InstallArgs,
): Promise<ExtensionInstallMetadata | undefined> {
  const source = args.source;
  if (source) {
    return resolveSourceInstallMetadata(source, args);
  }
  if (args.path) {
    return {
      source: args.path,
      type: 'local',
      autoUpdate: args.autoUpdate,
    };
  }
  throw new Error('Either --source or --path must be provided.');
}

/**
 * Resolves install metadata for source-based installs.
 */
async function resolveSourceInstallMetadata(
  source: string,
  args: InstallArgs,
): Promise<ExtensionInstallMetadata | undefined> {
  if (
    source.startsWith('http://') ||
    source.startsWith('https://') ||
    source.startsWith('git@')
  ) {
    return {
      source,
      type: 'git',
      ref: args.ref,
      autoUpdate: args.autoUpdate,
    };
  }
  if (source.startsWith('sso://')) {
    console.warn(
      'sso:// URLs require a git-remote-sso helper to be installed. See https://github.com/google/git-remote-sso for more information.',
    );
    return {
      source,
      type: 'git',
      ref: args.ref,
      autoUpdate: args.autoUpdate,
    };
  }
  return resolveOrgRepoOrLocalSource(source, args);
}

/**
 * Resolves source that may be org/repo format or a local path.
 */
async function resolveOrgRepoOrLocalSource(
  source: string,
  args: InstallArgs,
): Promise<ExtensionInstallMetadata | undefined> {
  try {
    const { owner, repo } = parseGitHubRepoForReleases(source);
    const hasReleases = await checkReleasesOrFalse(owner, repo);
    if (hasReleases) {
      return {
        source,
        type: 'github-release',
        ref: args.ref,
        autoUpdate: args.autoUpdate,
      };
    }
    return {
      source: `https://github.com/${owner}/${repo}.git`,
      type: 'git',
      ref: args.ref,
      autoUpdate: args.autoUpdate,
    };
  } catch {
    // Not org/repo format, check if it's a local path
    return resolveLocalPathSource(source, args);
  }
}

/**
 * Checks if GitHub releases exist, returning false on error.
 */
async function checkReleasesOrFalse(
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    return await checkGitHubReleasesExist(owner, repo);
  } catch {
    return false;
  }
}

/**
 * Resolves a local path source, exiting CLI if not found.
 */
async function resolveLocalPathSource(
  source: string,
  args: InstallArgs,
): Promise<ExtensionInstallMetadata | undefined> {
  try {
    await fs.stat(source);
    return {
      source,
      type: 'local',
      autoUpdate: args.autoUpdate,
    };
  } catch {
    console.error('Install source not found.');
    await exitCli(1);
    return undefined;
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
    await exitCli();
  },
};
