/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { debugLogger, type SkillDefinition } from '@vybestack/llxprt-code-core';
import { getErrorMessage } from '../../utils/errors.js';
import { exitCli } from '../utils.js';
import { installSkill } from '../../utils/skillUtils.js';
import {
  skillsConsentString,
  requestConsentNonInteractive,
} from '../../config/extensions/consent.js';
import chalk from 'chalk';

interface InstallArgs {
  source: string;
  scope?: 'user' | 'workspace';
  path?: string;
  consent?: boolean;
}

export async function handleInstall(args: InstallArgs) {
  try {
    const { source, consent } = args;
    const scope = args.scope ?? 'user';
    const subpath = args.path;

    const requestConsentCallback = async (
      skills: SkillDefinition[],
      targetDir: string,
    ): Promise<boolean> => {
      const consentText = await skillsConsentString(skills, source, targetDir);
      if (consent === true) {
        debugLogger.log('You have consented to the following:');
        debugLogger.log(consentText);
        return true;
      }
      return requestConsentNonInteractive(consentText);
    };

    const installedSkills = await installSkill(
      source,
      scope,
      subpath,
      (msg) => {
        debugLogger.log(msg);
      },
      requestConsentCallback,
    );

    for (const skill of installedSkills) {
      debugLogger.log(
        chalk.green(
          `Successfully installed skill: ${chalk.bold(skill.name)} (scope: ${scope}, location: ${skill.location})`,
        ),
      );
    }
  } catch (error) {
    debugLogger.error(getErrorMessage(error));
    await exitCli(1);
  }
}

export const installCommand: CommandModule = {
  command: 'install <source> [--scope] [--path]',
  describe: 'Installs a skill from a git repository URL or a local path.',
  builder: (yargs) =>
    yargs
      .positional('source', {
        describe:
          'The git repository URL or local path of the skill to install.',
        type: 'string',
        demandOption: true,
      })
      .option('scope', {
        describe:
          'The scope to install the skill into. Defaults to "user" (global).',
        choices: ['user', 'workspace'],
        default: 'user',
      })
      .option('path', {
        describe:
          'Sub-path within the repository to install from (only used for git repository sources).',
        type: 'string',
      })
      .option('consent', {
        describe:
          'Acknowledge the security risks of installing a skill and skip the confirmation prompt.',
        type: 'boolean',
        default: false,
      })
      .check((argv) => {
        if (!argv.source) {
          throw new Error('The source argument must be provided.');
        }
        return true;
      }),
  handler: async (argv) => {
    await handleInstall({
      source: argv['source'] as string,
      scope: argv['scope'] as 'user' | 'workspace',
      path: argv['path'] as string | undefined,
      consent: argv['consent'] as boolean | undefined,
    });
    await exitCli();
  },
};
