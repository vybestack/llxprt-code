/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// These imports will be needed when the command is re-enabled
import path from 'path';
import fs from 'fs';
// import { CommandContext } from '../../ui/commands/types.js';
// import {
//   getGitRepoRoot,
//   getLatestGitHubRelease,
//   isGitHubRepository,
// } from '../../utils/gitUtils.js';

import {
  CommandKind,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
// TODO: Re-add imports when the setup-github command is re-enabled
// import { getUrlOpenCommand } from '../../ui/utils/commandUtils.js';
// import { getGitHubRepoInfo } from '../../utils/gitUtils.js';

export const GITHUB_WORKFLOW_PATHS = [
  'gemini-dispatch/gemini-dispatch.yml',
  'gemini-assistant/gemini-invoke.yml',
  'issue-triage/gemini-triage.yml',
  'issue-triage/gemini-scheduled-triage.yml',
  'pr-review/gemini-review.yml',
];

// TODO: Reimplement getOpenUrlsCommands when the setup-github command is re-enabled
// This function was removed because it's currently unused but kept for reference
// function getOpenUrlsCommands(readmeUrl: string): string[] {
//   // Determine the OS-specific command to open URLs, ex: 'open', 'xdg-open', etc
//   const openCmd = getUrlOpenCommand();
//
//   // Build a list of URLs to open
//   const urlsToOpen = [readmeUrl];
//
//   const repoInfo = getGitHubRepoInfo();
//   if (repoInfo) {
//     urlsToOpen.push(
//       `https://github.com/${repoInfo.owner}/${repoInfo.repo}/settings/secrets/actions`,
//     );
//   }
//
//   // Create and join the individual commands
//   const commands = urlsToOpen.map((url) => `${openCmd} "${url}"`);
//   return commands;
// }

// Add Gemini CLI specific entries to .gitignore file
export async function updateGitignore(gitRepoRoot: string): Promise<void> {
  const gitignoreEntries = ['.gemini/', 'gha-creds-*.json'];

  const gitignorePath = path.join(gitRepoRoot, '.gitignore');
  try {
    // Check if .gitignore exists and read its content
    let existingContent = '';
    let fileExists = true;
    try {
      existingContent = await fs.promises.readFile(gitignorePath, 'utf8');
    } catch (_error) {
      // File doesn't exist
      fileExists = false;
    }

    if (!fileExists) {
      // Create new .gitignore file with the entries
      const contentToWrite = gitignoreEntries.join('\n') + '\n';
      await fs.promises.writeFile(gitignorePath, contentToWrite);
    } else {
      // Check which entries are missing
      const missingEntries = gitignoreEntries.filter(
        (entry) =>
          !existingContent
            .split(/\r?\n/)
            .some((line) => line.split('#')[0].trim() === entry),
      );

      if (missingEntries.length > 0) {
        const contentToAdd = '\n' + missingEntries.join('\n') + '\n';
        await fs.promises.appendFile(gitignorePath, contentToAdd);
      }
    }
  } catch (error) {
    console.debug('Failed to update .gitignore:', error);
    // Continue without failing the whole command
  }
}

export const setupGithubCommand: SlashCommand = {
  name: 'setup-github',
  description:
    'Set up GitHub Actions (currently disabled - needs adaptation for llxprt)',
  kind: CommandKind.BUILT_IN,
  action: (): SlashCommandActionReturn =>
    // TODO: Adapt this command for llxprt-code
    // Need to:
    // 1. Create our own GitHub Actions repository (e.g., acoliver/run-llxprt-code or vybestack/run-llxprt-code)
    // 2. Adapt the workflows to use llxprt instead of gemini
    // 3. Support multi-provider configuration in the workflows
    // 4. Update the URLs below to point to our repository
    // 5. Consider including the cherry-picker workflow as part of the setup

    // For now, return an informative message
    ({
      type: 'message',
      messageType: 'info',
      content: `The /setup-github command is currently disabled and needs adaptation for llxprt-code.

This command would download GitHub Actions workflows for:
- Automated PR reviews using llxprt
- Issue triage and labeling
- General AI assistance via @llxprt-cli mentions
- (Potentially) Automated upstream sync via cherry-picking

To implement this feature:
1. Fork https://github.com/acoliver/run-llxprt-code
2. Adapt it for multi-provider support
3. Update this command to point to the new repository

For now, you can manually set up GitHub Actions by creating workflows that use llxprt-code.`,
    }),

  /* Original gemini implementation with GitHub API integration - kept for reference:
  action: async (
    context: CommandContext,
  ): Promise<SlashCommandActionReturn> => {
    if (!isGitHubRepository()) {
      throw new Error(
        'Unable to determine the GitHub repository. /setup-github must be run from a git repository.',
      );
    }

    // Find the root directory of the repo
    let gitRepoRoot: string;
    try {
      gitRepoRoot = getGitRepoRoot();
    } catch (_error) {
      console.debug(`Failed to get git repo root:`, _error);
      throw new Error(
        'Unable to determine the GitHub repository. /setup-github must be run from a git repository.',
      );
    }

    // Get the latest release tag from GitHub API
    // For llxprt, this would call getLatestGitHubRelease() which points to acoliver/run-llxprt-code
    const proxy = context?.services?.config?.getProxy();
    const releaseTag = await getLatestGitHubRelease(proxy);

    // Create the .github/workflows directory to download the files into
    const githubWorkflowsDir = path.join(gitRepoRoot, '.github', 'workflows');
    try {
      await fs.promises.mkdir(githubWorkflowsDir, { recursive: true });
    } catch (_error) {
      console.debug(
        `Failed to create ${githubWorkflowsDir} directory:`,
        _error,
      );
      throw new Error(
        `Unable to create ${githubWorkflowsDir} directory. Do you have file permissions in the current directory?`,
      );
    }

    // Download each workflow in parallel - there aren't enough files to warrant
    // a full workerpool model here.
    const downloads = [];
    for (const workflow of GITHUB_WORKFLOW_PATHS) {
      downloads.push(
        (async () => {
          const endpoint = `https://raw.githubusercontent.com/google-github-actions/run-gemini-cli/refs/tags/${releaseTag}/examples/workflows/${workflow}`;
          const response = await fetch(endpoint, {
            method: 'GET',
            dispatcher: proxy ? new ProxyAgent(proxy) : undefined,
            signal: AbortSignal.any([
              AbortSignal.timeout(30_000),
              abortController.signal,
            ]),
          } as RequestInit);

          if (!response.ok) {
            throw new Error(
              `Invalid response code downloading ${endpoint}: ${response.status} - ${response.statusText}`,
            );
          }
          const body = response.body;
          if (!body) {
            throw new Error(
              `Empty body while downloading ${endpoint}: ${response.status} - ${response.statusText}`,
            );
          }

          const destination = path.resolve(
            githubWorkflowsDir,
            path.basename(workflow),
          );

          const fileStream = fs.createWriteStream(destination, {
            mode: 0o644, // -rw-r--r--, user(rw), group(r), other(r)
            flags: 'w', // write and overwrite
            flush: true,
          });

          await body.pipeTo(Writable.toWeb(fileStream));
        })(),
      );
    }

    const readmeUrl = `https://github.com/google-github-actions/run-gemini-cli/blob/${releaseTag}/README.md#quick-start`;

    // Add entries to .gitignore file
    await updateGitignore(gitRepoRoot);

    // Print out a message
    const commands = [];
    commands.push('set -eEuo pipefail');
    commands.push(
      `echo "Successfully downloaded ${GITHUB_WORKFLOW_PATHS.length} workflows and updated .gitignore. Follow the steps in ${readmeUrl} (skipping the /setup-github step) to complete setup."`,
    );

    commands.push(...getOpenUrlsCommands(readmeUrl));

    const command = `(${commands.join(' && ')})`;
    return {
      type: 'tool',
      toolName: 'run_shell_command',
      toolArgs: {
        description:
          'Setting up GitHub Actions to triage issues and review PRs with llxprt.',
        command,
      },
    };
  },
  */
};

// buildCurlCommand is a helper for constructing a consistent curl command.
// Commented out until the command is re-enabled
// function buildCurlCommand(u: string, additionalArgs?: string[]): string {
//   const args = [];
//   args.push('--fail');
//   args.push('--location');
//   args.push('--show-error');
//   args.push('--silent');
//
//   for (const val of additionalArgs || []) {
//     args.push(val);
//   }
//
//   args.sort();
//
//   return `curl ${args.join(' ')} "${u}"`;
// }
