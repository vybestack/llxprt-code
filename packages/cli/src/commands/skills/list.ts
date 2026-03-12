/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { MessageBus, debugLogger } from '@vybestack/llxprt-code-core';
import { loadSettings } from '../../config/settings.js';
import { loadCliConfig, type CliArgs } from '../../config/config.js';
import {
  loadExtensions,
  ExtensionEnablementManager,
} from '../../config/extension.js';

import { exitCli } from '../utils.js';
import chalk from 'chalk';

export async function handleList() {
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
  const skills = skillManager.getAllSkills();

  if (skills.length === 0) {
    debugLogger.log('No skills discovered.');
    return;
  }

  debugLogger.log(chalk.bold('Discovered Agent Skills:'));
  debugLogger.log('');

  for (const skill of skills) {
    const status = skill.disabled
      ? chalk.red('[Disabled]')
      : chalk.green('[Enabled]');

    debugLogger.log(`${chalk.bold(skill.name)} ${status}`);
    debugLogger.log(`  Description: ${skill.description}`);
    debugLogger.log(`  Location:    ${skill.location}`);
    debugLogger.log('');
  }
}

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'Lists discovered agent skills.',
  builder: (yargs) => yargs,
  handler: async () => {
    await handleList();
    await exitCli();
  },
};
