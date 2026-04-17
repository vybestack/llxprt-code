/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { loadSettings } from '../../config/settings.js';
import { exitCli } from '../utils.js';
import {
  type HookEventName,
  type HookDefinition,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface MigrateOptions {
  dryRun?: boolean;
  confirm?: boolean;
}

async function migrateHooks(options: MigrateOptions): Promise<void> {
  const { dryRun = false, confirm = false } = options;

  const settings = loadSettings();
  const userHooks = settings.merged.hooks;

  if (!userHooks || Object.keys(userHooks).length === 0) {
    debugLogger.log('No hooks found in user settings. Nothing to migrate.');
    return;
  }

  // Find the workspace root by looking for .llxprt directory
  let currentDir = process.cwd();
  let projectRoot: string | null = null;

  // Walk up directory tree to find .llxprt
  while (currentDir !== path.dirname(currentDir)) {
    const llxprtDir = path.join(currentDir, '.llxprt');
    if (fs.existsSync(llxprtDir) && fs.statSync(llxprtDir).isDirectory()) {
      projectRoot = currentDir;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (!projectRoot) {
    debugLogger.error(
      'Error: Could not find .llxprt directory in current path.',
    );
    debugLogger.error(
      'Please run this command from within a project directory.',
    );
    process.exit(1);
  }

  const projectSettingsPath = path.join(
    projectRoot,
    '.llxprt',
    'settings.json',
  );

  // Load or initialize project settings
  let projectSettings: { hooks?: { [K in HookEventName]?: HookDefinition[] } } =
    {};

  if (fs.existsSync(projectSettingsPath)) {
    try {
      const content = fs.readFileSync(projectSettingsPath, 'utf-8');
      projectSettings = JSON.parse(content);
    } catch (error) {
      debugLogger.error(`Error reading ${projectSettingsPath}:`, error);
      process.exit(1);
    }
  }

  // Merge hooks, deduplicating by checking command/plugin equality
  const mergedHooks: { [K in HookEventName]?: HookDefinition[] } = {
    ...projectSettings.hooks,
  };

  let changesMade = false;

  for (const [eventName, definitions] of Object.entries(userHooks)) {
    // Skip the 'disabled' property which isn't an event
    if (eventName === 'disabled' || !Array.isArray(definitions)) continue;

    const typedEventName = eventName as HookEventName;

    if (!mergedHooks[typedEventName]) {
      mergedHooks[typedEventName] = [];
      changesMade = true;
    }

    for (const definition of definitions as unknown as HookDefinition[]) {
      // Check if this definition already exists in project hooks
      const exists = mergedHooks[typedEventName].some(
        (existing) => JSON.stringify(existing) === JSON.stringify(definition),
      );

      if (!exists) {
        mergedHooks[typedEventName].push(definition);
        changesMade = true;
      }
    }
  }

  if (!changesMade) {
    debugLogger.log(
      'All hooks from user settings already exist in project settings.',
    );
    return;
  }

  if (dryRun) {
    debugLogger.log('DRY RUN - Changes that would be made:');
    debugLogger.log('\nProject settings path:', projectSettingsPath);
    debugLogger.log('\nMerged hooks configuration:');
    debugLogger.log(JSON.stringify({ hooks: mergedHooks }, null, 2));
    return;
  }

  if (!confirm) {
    debugLogger.log('Migration preview:');
    debugLogger.log('\nProject settings path:', projectSettingsPath);
    debugLogger.log('\nMerged hooks configuration:');
    debugLogger.log(JSON.stringify({ hooks: mergedHooks }, null, 2));
    debugLogger.log('\nRe-run with --confirm to apply these changes.');
    return;
  }

  // Apply changes
  projectSettings.hooks = mergedHooks;

  // Ensure .llxprt directory exists
  const llxprtDir = path.dirname(projectSettingsPath);
  if (!fs.existsSync(llxprtDir)) {
    fs.mkdirSync(llxprtDir, { recursive: true });
  }

  // Write project settings
  try {
    fs.writeFileSync(
      projectSettingsPath,
      JSON.stringify(projectSettings, null, 2) + '\n',
      'utf-8',
    );
    debugLogger.log(`Successfully migrated hooks to ${projectSettingsPath}`);
  } catch (error) {
    debugLogger.error(`Error writing ${projectSettingsPath}:`, error);
    process.exit(1);
  }
}

export const migrateCommand: CommandModule<object, MigrateOptions> = {
  command: 'migrate',
  describe: 'Migrate hooks from user settings to project-level config',
  builder: (yargs) =>
    yargs
      .option('dry-run', {
        type: 'boolean',
        description: 'Show what would be migrated without making changes',
        default: false,
      })
      .option('confirm', {
        type: 'boolean',
        description: 'Confirm migration and apply changes',
        default: false,
      }),
  handler: async (argv) => {
    await migrateHooks(argv);
    await exitCli();
  },
};
