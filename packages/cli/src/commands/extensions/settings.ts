/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CommandModule } from 'yargs';

import { getExtensionAndConfig } from './utils.js';
import {
  getEnvContents,
  updateSetting,
  ExtensionSettingScope,
} from '../../config/extensions/settingsIntegration.js';
import { exitCli } from '../utils.js';

interface SetArgs {
  name: string;
  setting: string;
  scope?: string;
}

interface ListArgs {
  name: string;
  scope?: string;
}

/**
 * Prompts for a setting value using readline.
 */
async function promptForSetting(
  prompt: string,
  sensitive: boolean,
): Promise<string> {
  if (sensitive && process.stdin.isTTY) {
    // Hide input for sensitive settings
    return new Promise<string>((resolve) => {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();

      let input = '';
      const onData = (data: Buffer): void => {
        const char = data.toString('utf-8');
        if (char === '\n' || char === '\r') {
          stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
        } else if (char === '\x7f' || char === '\b') {
          // Backspace
          input = input.slice(0, -1);
        } else if (char === '\x03') {
          // Ctrl+C
          stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve('');
        } else {
          input += char;
        }
      };
      stdin.on('data', onData);
    });
  } else {
    const readline = await import('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

/**
 * Handler for 'extensions settings set' command.
 */
async function handleSet(args: SetArgs): Promise<void> {
  const { extension, extensionConfig } = await getExtensionAndConfig(args.name);

  if (!extension || !extensionConfig) {
    return;
  }

  // Parse scope argument
  const scope =
    args.scope === 'workspace'
      ? ExtensionSettingScope.WORKSPACE
      : ExtensionSettingScope.USER;

  await updateSetting(
    extensionConfig.name,
    extension.path,
    args.setting,
    promptForSetting,
    scope,
  );
}

/**
 * Handler for 'extensions settings list' command.
 */
async function handleList(args: ListArgs): Promise<void> {
  const { extension, extensionConfig } = await getExtensionAndConfig(args.name);

  if (!extension || !extensionConfig) {
    return;
  }

  // Parse scope argument
  const scope =
    args.scope === 'workspace'
      ? ExtensionSettingScope.WORKSPACE
      : args.scope === 'user'
        ? ExtensionSettingScope.USER
        : undefined; // undefined means merge both scopes

  const contents = await getEnvContents(
    extensionConfig.name,
    extension.path,
    scope,
  );

  if (contents.length === 0) {
    console.log(`Extension "${args.name}" has no settings.`);
    return;
  }

  const scopeLabel = scope ? ` (${scope} scope)` : ' (merged user + workspace)';
  console.log(`Settings for extension "${args.name}"${scopeLabel}:`);
  for (const { name, value } of contents) {
    console.log(`  ${name}: ${value}`);
  }
}

export const setCommand: CommandModule = {
  command: 'set <name> <setting>',
  describe: 'Sets a specific extension setting.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension.',
        type: 'string',
        demandOption: true,
      })
      .positional('setting', {
        describe: 'The name or environment variable of the setting to update.',
        type: 'string',
        demandOption: true,
      })
      .option('scope', {
        describe: 'Setting scope: user (default) or workspace',
        type: 'string',
        choices: ['user', 'workspace'],
        default: 'user',
      }),
  handler: async (argv) => {
    await handleSet({
      name: argv['name'] as string,
      setting: argv['setting'] as string,
      scope: argv['scope'] as string | undefined,
    });
    await exitCli();
  },
};

export const listCommand: CommandModule = {
  command: 'list <name>',
  describe: 'Lists all settings for an extension.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension.',
        type: 'string',
        demandOption: true,
      })
      .option('scope', {
        describe: 'Setting scope: user, workspace, or omit to merge both',
        type: 'string',
        choices: ['user', 'workspace'],
      }),
  handler: async (argv) => {
    await handleList({
      name: argv['name'] as string,
      scope: argv['scope'] as string | undefined,
    });
    await exitCli();
  },
};

export const settingsCommand: CommandModule = {
  command: 'settings <command>',
  describe: 'Manage extension settings.',
  builder: (yargs) =>
    yargs
      .command(setCommand)
      .command(listCommand)
      .demandCommand(1, 'You need at least one command before continuing.')
      .version(false),
  handler: () => {
    // This handler is not called when a subcommand is provided.
  },
};
