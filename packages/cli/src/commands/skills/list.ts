/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { configureCommandOptions } from '../command-configuration.js';
import {
  MCPOAuthTokenStorage,
  KeychainTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import { defaultBrowserLauncher } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

import { discoverAgentSkills } from '@vybestack/llxprt-code-agents';

import type { CommandModule } from 'yargs';
import { writeToStdout } from '@vybestack/llxprt-code-core';
import { loadSettings } from '../../config/settings.js';
import {
  resolveDeclarativeCliConfig,
  type DeclarativeCliConfig,
} from '../../config/declarativeCliConfig.js';
import { type CliArgs } from '../../config/cliArgParser.js';
import {
  loadExtensions,
  ExtensionEnablementManager,
} from '../../config/extension.js';

import { exitCli } from '../utils.js';
import chalk from 'chalk';

function printLine(line: string): void {
  writeToStdout(`${line}\n`);
}

type SkillDiscoveryIntent = Parameters<typeof discoverAgentSkills>[0];

function skillDiscoveryIntent(
  declarative: DeclarativeCliConfig,
  argv: CliArgs,
  workspaceDir: string,
): SkillDiscoveryIntent {
  const { context, intermediate } = declarative;
  const profileSettings = intermediate.profileSettingsWithTools;
  const mcpEnabled = intermediate.mcpEnabled;
  return {
    workingDir: workspaceDir,
    debugMode: context.debugMode,
    trustedFolder: context.trustedFolder,
    skillsEnabled:
      profileSettings.experimental?.skills === true ||
      (profileSettings.skills?.enabled ?? true),
    disabledSkills: profileSettings.skills?.disabled,
    adminSkillsEnabled: intermediate.adminSkillsEnabled,
    extensions: context.allExtensions,
    mcpEnabled,
    mcpServers: mcpEnabled ? declarative.mcpServers : {},
    mcpServerCommand: mcpEnabled ? profileSettings.mcpServerCommand : undefined,
    allowedMcpServers: mcpEnabled
      ? (argv.allowedMcpServerNames ?? profileSettings.mcp?.allowed)
      : undefined,
    blockedMcpServers: declarative.blockedMcpServers,
    includeDirectories: context.includeDirectories,
  };
}

export async function handleList(showAll = false) {
  const workspaceDir = process.cwd();
  const settings = loadSettings(workspaceDir);
  const extensionEnablementManager = new ExtensionEnablementManager(
    workspaceDir,
  );
  const extensions = loadExtensions(extensionEnablementManager, workspaceDir);
  const argv = { debug: false } as Partial<CliArgs> as CliArgs;

  const declarative = await resolveDeclarativeCliConfig({
    settings: settings.merged,
    argv,
    cwd: workspaceDir,
    extensions,
    extensionEnablementManager,
  });

  let skills = await discoverAgentSkills(
    skillDiscoveryIntent(declarative, argv, workspaceDir),
    {
      oauth: {
        tokenStorage: new MCPOAuthTokenStorage(
          new KeychainTokenStorage('llxprt-cli-mcp-oauth'),
        ),
        openBrowser: defaultBrowserLauncher,
      },
    },
  );

  // By default, filter out built-in skills unless --all is specified
  if (!showAll) {
    skills = skills.filter((skill) => skill.source !== 'builtin');
  }

  if (skills.length === 0) {
    printLine('No skills discovered.');
    return;
  }

  printLine(chalk.bold('Discovered Skills:'));
  printLine('');

  for (const skill of skills) {
    const status =
      skill.disabled === true
        ? chalk.red('[Disabled]')
        : chalk.green('[Enabled]');

    // Show source indicator for non-user/project skills
    let sourceLabel = '';
    if (skill.source === 'builtin') {
      sourceLabel = chalk.dim(' [Built-in]');
    } else if (skill.source === 'extension') {
      sourceLabel = chalk.dim(' [Extension]');
    }

    printLine(`${chalk.bold(skill.name)} ${status}${sourceLabel}`);
    printLine(`  Description: ${skill.description}`);
    printLine(`  Location:    ${skill.location}`);
    printLine('');
  }
}

export const listCommand: CommandModule = {
  command: 'list [--all]',
  describe: 'Lists discovered skills.',
  builder: (yargs) =>
    configureCommandOptions(yargs, (configuration) =>
      configuration.option('all', {
        type: 'boolean',
        default: false,
        describe: 'Include built-in skills in the listing',
      }),
    ),
  handler: async (argv) => {
    await handleList(argv.all as boolean);
    await exitCli();
  },
};
