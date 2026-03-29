/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { MessageBus, debugLogger } from '@vybestack/llxprt-code-core';
import { loadSettings } from '../../config/settings.js';
import { loadCliConfig } from '../../config/config.js';
import type { CliArgs } from '../../config/cliArgParser.js';
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

  const sessionMessageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );

  // Initialize to trigger extension loading and skill discovery
  await (
    config as typeof config & {
      initialize(dependencies?: { messageBus?: MessageBus }): Promise<void>;
    }
  ).initialize({ messageBus: sessionMessageBus });

  const skillManager = config.getSkillManager();
  let skills = skillManager.getAllSkills();

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
    const status = skill.disabled
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
    yargs.option('all', {
      type: 'boolean',
      default: false,
      describe: 'Include built-in skills in the listing',
    }),
  handler: async (argv) => {
    await handleList(argv.all as boolean);
    await exitCli();
  },
};
