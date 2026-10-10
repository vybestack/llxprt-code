import { cliSkillOperations } from '../../config/configBuilder.js';
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

import { McpRuntimeOwner } from '@vybestack/llxprt-code-agents';

import type { CommandModule } from 'yargs';
import { discoverSkillsForConfig } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { loadSettings } from '../../config/settings.js';
import { loadCliConfig } from '../../config/config.js';
import { type CliArgs } from '../../config/cliArgParser.js';
import {
  loadExtensions,
  ExtensionEnablementManager,
} from '../../config/extension.js';

import { exitCli } from '../utils.js';
import chalk from 'chalk';

export async function handleList(showAll = false) {
  const workspaceDir = process.cwd();
  const settings = loadSettings(workspaceDir);
  const extensionEnablementManager = new ExtensionEnablementManager(
    workspaceDir,
  );
  const extensions = loadExtensions(extensionEnablementManager, workspaceDir);

  const config = await loadCliConfig(
    settings.merged,
    extensions,
    extensionEnablementManager,
    'skills-list-session',
    {
      debug: false,
    } as Partial<CliArgs> as CliArgs,
    workspaceDir,
  );

  const mcpRuntime = await McpRuntimeOwner.create(
    {
      tokenStorage: new MCPOAuthTokenStorage(
        new KeychainTokenStorage('llxprt-cli-mcp-oauth'),
      ),
      openBrowser: defaultBrowserLauncher,
    },
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    cliSkillOperations(config),
  );
  let skills;
  try {
    skills = await discoverSkillsForConfig(
      { list: (all) => mcpRuntime.workspaceSkills.operations.list(all) },
      () => mcpRuntime.initialize(),
    );
  } finally {
    await mcpRuntime.dispose();
    await config.dispose();
  }

  // By default, filter out built-in skills unless --all is specified
  if (!showAll) {
    skills = skills.filter((skill) => skill.source !== 'builtin');
  }

  if (skills.length === 0) {
    debugLogger.log('No skills discovered.');
    return;
  }

  debugLogger.log(chalk.bold('Discovered Skills:'));
  debugLogger.log('');

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

    debugLogger.log(`${chalk.bold(skill.name)} ${status}${sourceLabel}`);
    debugLogger.log(`  Description: ${skill.description}`);
    debugLogger.log(`  Location:    ${skill.location}`);
    debugLogger.log('');
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
