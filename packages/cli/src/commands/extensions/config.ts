/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CommandModule } from 'yargs';

import { getExtensionAndConfig } from './utils.js';
import {
  updateSetting,
  getScopedEnvContents,
  ExtensionSettingScope,
  loadExtensionSettingsFromManifest,
} from '../../config/extensions/settingsIntegration.js';
import {
  loadUserExtensions,
  loadExtensionConfig,
} from '../../config/extension.js';
import { exitCli } from '../utils.js';
import { promptForSetting } from './settings.js';

interface ConfigArgs {
  name?: string;
  setting?: string;
  scope?: string;
}

/**
 * Prompts for overwrite confirmation using readline.
 * Exported for testing.
 */
export async function confirmOverwrite(settingName: string): Promise<boolean> {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise<boolean>((resolve) => {
    rl.question(
      `Setting "${settingName}" is already set. Overwrite? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      },
    );
  });
}

/**
 * Configures a single setting for an extension.
 */
async function configureSetting(
  extensionName: string,
  extensionPath: string,
  settingKey: string,
  scope: ExtensionSettingScope,
): Promise<boolean> {
  const success = await updateSetting(
    extensionName,
    extensionPath,
    settingKey,
    promptForSetting,
    scope,
  );
  return success;
}

/**
 * Configures all settings for a single extension interactively.
 */
async function configureAllSettings(
  extensionName: string,
  extensionPath: string,
  scope: ExtensionSettingScope,
): Promise<boolean> {
  const settings = loadExtensionSettingsFromManifest(extensionPath);

  if (settings.length === 0) {
    console.log(`Extension "${extensionName}" has no settings to configure.`);
    return true;
  }

  console.log(`Configuring settings for extension "${extensionName}"...`);

  const currentScopeValues = await getScopedEnvContents(
    extensionName,
    extensionPath,
    scope,
  );

  // If configuring user scope, check for workspace values
  let workspaceScopeValues: Record<string, string | undefined> = {};
  if (scope === ExtensionSettingScope.USER) {
    workspaceScopeValues = await getScopedEnvContents(
      extensionName,
      extensionPath,
      ExtensionSettingScope.WORKSPACE,
    );
  }

  let allSuccess = true;

  for (const setting of settings) {
    const currentValue = currentScopeValues[setting.envVar];
    const workspaceValue =
      scope === ExtensionSettingScope.USER
        ? workspaceScopeValues[setting.envVar]
        : undefined;

    // Show advisory if configuring user scope but workspace has a value
    if (scope === ExtensionSettingScope.USER && workspaceValue) {
      console.log(
        `Note: Setting "${setting.name}" has a workspace value. User scope value will take precedence.`,
      );
    }

    // Check if value already set in current scope
    if (currentValue && currentValue !== '[not set]') {
      const shouldOverwrite = await confirmOverwrite(setting.name);
      if (!shouldOverwrite) {
        console.log(`Skipping "${setting.name}".`);
        continue;
      }
    }

    const success = await updateSetting(
      extensionName,
      extensionPath,
      setting.envVar,
      promptForSetting,
      scope,
    );

    if (!success) {
      allSuccess = false;
      console.error(`Failed to configure setting "${setting.name}".`);
    }
  }

  return allSuccess;
}

/**
 * Handler for 'extensions config' command.
 */
async function handleConfig(args: ConfigArgs): Promise<void> {
  const scope =
    args.scope === 'workspace'
      ? ExtensionSettingScope.WORKSPACE
      : ExtensionSettingScope.USER;

  // Case 1: config <name> <setting> - configure specific setting
  if (args.name && args.setting) {
    const { extension, extensionConfig } = await getExtensionAndConfig(
      args.name,
    );

    if (!extension || !extensionConfig) {
      return;
    }

    await configureSetting(
      extensionConfig.name,
      extension.path,
      args.setting,
      scope,
    );
    return;
  }

  // Case 2: config <name> - configure all settings for one extension
  if (args.name) {
    const { extension, extensionConfig } = await getExtensionAndConfig(
      args.name,
    );

    if (!extension || !extensionConfig) {
      return;
    }

    await configureAllSettings(extensionConfig.name, extension.path, scope);
    return;
  }

  // Case 3: config - configure all installed extensions
  const installedExtensions = loadUserExtensions();

  if (installedExtensions.length === 0) {
    console.log('No extensions installed.');
    return;
  }

  console.log(
    `Found ${installedExtensions.length} installed extension(s). Starting configuration...`,
  );

  let overallSuccess = true;

  for (const extension of installedExtensions) {
    try {
      const extensionConfig = await loadExtensionConfig({
        extensionDir: extension.path,
        workspaceDir: process.cwd(),
      });

      if (!extensionConfig) {
        console.error(
          `Failed to load configuration for extension "${extension.name}". Skipping.`,
        );
        overallSuccess = false;
        continue;
      }

      console.log(`\nConfiguring extension "${extensionConfig.name}"...`);

      const success = await configureAllSettings(
        extensionConfig.name,
        extension.path,
        scope,
      );

      if (!success) {
        overallSuccess = false;
      }
    } catch (error) {
      console.error(
        `Error configuring extension "${extension.name}":`,
        error instanceof Error ? error.message : String(error),
      );
      overallSuccess = false;
    }
  }

  if (!overallSuccess) {
    console.error(
      '\nConfiguration completed with errors. Some extensions may not be fully configured.',
    );
    process.exitCode = 1;
  } else {
    console.log('\nAll extensions configured successfully.');
  }
}

export const configCommand: CommandModule = {
  command: 'config [name] [setting]',
  describe: 'Configure extension settings interactively.',
  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: 'The name of the extension (optional).',
        type: 'string',
      })
      .positional('setting', {
        describe:
          'The name or environment variable of a specific setting (optional).',
        type: 'string',
      })
      .option('scope', {
        describe: 'Setting scope: user (default) or workspace',
        type: 'string',
        choices: ['user', 'workspace'],
        default: 'user',
      }),
  handler: async (argv) => {
    await handleConfig({
      name: argv['name'] as string | undefined,
      setting: argv['setting'] as string | undefined,
      scope: argv['scope'] as string | undefined,
    });
    await exitCli();
  },
};
