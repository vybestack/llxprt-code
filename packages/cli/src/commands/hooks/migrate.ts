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

type ProjectSettings = { hooks?: { [K in HookEventName]?: HookDefinition[] } };

function findProjectRoot(): string | null {
  let currentDir = process.cwd();

  // Walk up directory tree to find .llxprt
  while (currentDir !== path.dirname(currentDir)) {
    const llxprtDir = path.join(currentDir, '.llxprt');
    if (fs.existsSync(llxprtDir) && fs.statSync(llxprtDir).isDirectory()) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

function requireProjectRoot(): string {
  const projectRoot = findProjectRoot();
  if (projectRoot) return projectRoot;

  debugLogger.error('Error: Could not find .llxprt directory in current path.');
  debugLogger.error('Please run this command from within a project directory.');
  process.exit(1);
}

function loadProjectSettings(projectSettingsPath: string): ProjectSettings {
  if (!fs.existsSync(projectSettingsPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(projectSettingsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    debugLogger.error(`Error reading ${projectSettingsPath}:`, error);
    process.exit(1);
  }
}

function mergeHookDefinitions(
  userHooks: NonNullable<ReturnType<typeof loadSettings>['merged']['hooks']>,
  projectHooks: ProjectSettings['hooks'],
) {
  const mergedHooks: { [K in HookEventName]?: HookDefinition[] } = {
    ...projectHooks,
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
      const exists = mergedHooks[typedEventName].some(
        (existing) => JSON.stringify(existing) === JSON.stringify(definition),
      );

      if (!exists) {
        mergedHooks[typedEventName].push(definition);
        changesMade = true;
      }
    }
  }

  return { mergedHooks, changesMade };
}

function previewMigration(
  projectSettingsPath: string,
  mergedHooks: ProjectSettings['hooks'],
) {
  debugLogger.log('Migration preview:');
  debugLogger.log('\nProject settings path:', projectSettingsPath);
  debugLogger.log('\nMerged hooks configuration:');
  debugLogger.log(JSON.stringify({ hooks: mergedHooks }, null, 2));
  debugLogger.log('\nRe-run with --confirm to apply these changes.');
}

function previewDryRun(
  projectSettingsPath: string,
  mergedHooks: ProjectSettings['hooks'],
) {
  debugLogger.log('DRY RUN - Changes that would be made:');
  debugLogger.log('\nProject settings path:', projectSettingsPath);
  debugLogger.log('\nMerged hooks configuration:');
  debugLogger.log(JSON.stringify({ hooks: mergedHooks }, null, 2));
}

function writeProjectSettings(
  projectSettings: ProjectSettings,
  projectSettingsPath: string,
) {
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

async function migrateHooks(options: MigrateOptions): Promise<void> {
  const { dryRun = false, confirm = false } = options;

  const settings = loadSettings();
  const userHooks = settings.merged.hooks;

  if (!userHooks || Object.keys(userHooks).length === 0) {
    debugLogger.log('No hooks found in user settings. Nothing to migrate.');
    return;
  }

  const projectRoot = requireProjectRoot();
  const projectSettingsPath = path.join(
    projectRoot,
    '.llxprt',
    'settings.json',
  );
  const projectSettings = loadProjectSettings(projectSettingsPath);
  const { mergedHooks, changesMade } = mergeHookDefinitions(
    userHooks,
    projectSettings.hooks,
  );

  if (!changesMade) {
    debugLogger.log(
      'All hooks from user settings already exist in project settings.',
    );
    return;
  }

  if (dryRun) {
    previewDryRun(projectSettingsPath, mergedHooks);
    return;
  }

  if (!confirm) {
    previewMigration(projectSettingsPath, mergedHooks);
    return;
  }

  projectSettings.hooks = mergedHooks;
  writeProjectSettings(projectSettings, projectSettingsPath);
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
