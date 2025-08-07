/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// These imports will be needed when the command is re-enabled
// import path from 'path';
// import { CommandContext } from '../../ui/commands/types.js';
// import {
//   getGitRepoRoot,
//   getLatestGitHubRelease,
//   isGitHubRepository,
//   getGitHubRepoInfo,
// } from '../../utils/gitUtils.js';

import {
  CommandKind,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { getUrlOpenCommand } from '../../ui/utils/commandUtils.js';

// Generate OS-specific commands to open the GitHub pages needed for setup.
function getOpenUrlsCommands(readmeUrl: string): string[] {
  // Determine the OS-specific command to open URLs, ex: 'open', 'xdg-open', etc
  const openCmd = getUrlOpenCommand();

  // Build a list of URLs to open
  const urlsToOpen = [readmeUrl];

  const repoInfo = getGitHubRepoInfo();
  if (repoInfo) {
    urlsToOpen.push(
      `https://github.com/${repoInfo.owner}/${repoInfo.repo}/settings/secrets/actions`,
    );
  }

  // Create and join the individual commands
  const commands = urlsToOpen.map((url) => `${openCmd} "${url}"`);
  return commands;
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

    // TODO: Update these workflow paths for llxprt
    const workflows = [
      'llxprt-cli/llxprt-cli.yml',
      'issue-triage/llxprt-issue-automated-triage.yml',
      'issue-triage/llxprt-issue-scheduled-triage.yml',
      'pr-review/llxprt-pr-review.yml',
    ];

    const commands = [];

    // Ensure fast exit
    commands.push(`set -eEuo pipefail`);

    // Make the directory if it doesn't exist
    commands.push(`mkdir -p "${gitRepoRoot}/.github/workflows"`);

    for (const workflow of workflows) {
      const fileName = path.basename(workflow);
      // TODO: Update to use acoliver/run-llxprt-code repository
      const curlCommand = buildCurlCommand(
        `https://raw.githubusercontent.com/acoliver/run-llxprt-code/refs/tags/${releaseTag}/examples/workflows/${workflow}`,
        [`--output "${gitRepoRoot}/.github/workflows/${fileName}"`],
      );
      commands.push(curlCommand);
    }

    const readmeUrl = `https://github.com/google-github-actions/run-gemini-cli/blob/${releaseTag}/README.md#quick-start`;

    commands.push(
      `echo "Successfully downloaded ${workflows.length} workflows. Follow the steps in ${readmeUrl} (skipping the /setup-github step) to complete setup."`
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
