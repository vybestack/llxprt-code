/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ExtensionSettingsArraySchema,
  type ExtensionSetting,
} from './extensionSettings.js';
import {
  EXTENSIONS_CONFIG_FILENAME,
  EXTENSIONS_CONFIG_FILENAME_FALLBACK,
} from '../extension.js';
import { ExtensionSettingsStorage } from './settingsStorage.js';
import { maybePromptForSettings } from './settingsPrompt.js';
import { getWorkspaceIdentity } from '../../utils/gitUtils.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

/**
 * Scope for extension settings storage.
 */
export enum ExtensionSettingScope {
  /** User-level settings stored in extension directory */
  USER = 'user',
  /** Workspace-level settings stored in workspace directory */
  WORKSPACE = 'workspace',
}

/**
 * Loads extension settings from the manifest file.
 *
 * Tries llxprt-extension.json first, then falls back to gemini-extension.json.
 * Validates the settings array using ExtensionSettingArraySchema.
 *
 * @param extensionDir - The absolute path to the extension directory
 * @returns Array of validated extension settings, or empty array if none found or invalid
 */
export function loadExtensionSettingsFromManifest(
  extensionDir: string,
): ExtensionSetting[] {
  // Try llxprt-extension.json first
  let manifestPath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    // Fall back to gemini-extension.json
    manifestPath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK);
  }

  if (!fs.existsSync(manifestPath)) {
    // No manifest file found
    return [];
  }

  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as { settings?: unknown };

    // Extract settings array if present
    const settings = manifest.settings;

    if (!settings) {
      return [];
    }

    // Validate against schema
    const validationResult = ExtensionSettingsArraySchema.safeParse(settings);

    if (!validationResult.success) {
      // Invalid settings schema
      debugLogger.error(
        `Invalid settings schema in ${manifestPath}:`,
        validationResult.error,
      );
      return [];
    }

    return validationResult.data;
  } catch (error) {
    // Handle JSON parse errors or file read errors
    debugLogger.error(
      `Failed to read or parse manifest at ${manifestPath}:`,
      error,
    );
    return [];
  }
}

/**
 * Prompts the user for missing settings and saves them to storage.
 *
 * @param extensionName - The name of the extension
 * @param settings - Array of extension settings that may need values
 * @param existingValues - Record of existing setting values keyed by envVar
 * @param extensionDir - The absolute path to the extension directory
 * @returns Promise resolving to true if successful, false if user cancelled
 */
export async function maybePromptAndSaveSettings(
  extensionName: string,
  settings: ExtensionSetting[],
  existingValues: Record<string, string | undefined>,
  extensionDir: string,
): Promise<boolean> {
  // If no settings, nothing to do
  if (settings.length === 0) {
    return true;
  }

  // Prompt for settings
  const settingsValues = await maybePromptForSettings(settings, existingValues);

  // If null returned, user cancelled
  if (settingsValues === null) {
    return false;
  }

  // Save settings using ExtensionSettingsStorage
  const storage = new ExtensionSettingsStorage(extensionName, extensionDir);
  await storage.saveSettings(settings, settingsValues);

  return true;
}

/**
 * Loads saved extension settings as environment variables.
 * Merges user and workspace scopes, with workspace overriding user.
 *
 * Reads from both .env file (non-sensitive) and keychain (sensitive).
 *
 * @param extensionDir - The absolute path to the extension directory
 * @returns Promise resolving to record of environment variables
 */
export async function getExtensionEnvironment(
  extensionDir: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // Load settings definitions from manifest
  const settings = loadExtensionSettingsFromManifest(extensionDir);

  if (settings.length === 0) {
    return result;
  }

  // Parse manifest to get extension name
  let extensionName: string | null = null;
  let manifestPath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    manifestPath = path.join(extensionDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK);
  }

  if (fs.existsSync(manifestPath)) {
    try {
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent) as { name?: string };
      extensionName = manifest.name ?? null;
    } catch (error) {
      debugLogger.error(`Failed to read extension name from manifest:`, error);
    }
  }

  if (!extensionName) {
    return result;
  }

  // Load user scope settings
  const userStorage = new ExtensionSettingsStorage(extensionName, extensionDir);
  const userValues = await userStorage.loadSettings(settings);

  // Load workspace scope settings
  const workspaceRoot = getWorkspaceIdentity();
  const workspaceDir = path.join(
    workspaceRoot,
    '.llxprt',
    'extensions',
    extensionName,
  );
  const workspaceStorage = new ExtensionSettingsStorage(
    extensionName,
    workspaceDir,
  );
  const workspaceValues = await workspaceStorage.loadSettings(settings);

  // Merge user values first, then workspace values (workspace overrides user)
  for (const [key, value] of Object.entries(userValues)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  for (const [key, value] of Object.entries(workspaceValues)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Gets the path to the .env file for a specific scope.
 *
 * @param extensionName - Extension name
 * @param extensionDir - Extension directory path
 * @param scope - Setting scope (user or workspace)
 * @returns Path to the .env file for the specified scope
 */
export function getEnvFilePath(
  extensionName: string,
  extensionDir: string,
  scope: ExtensionSettingScope,
): string {
  if (scope === ExtensionSettingScope.WORKSPACE) {
    // Workspace settings go in workspace .llxprt/extensions/{extensionName}/.env
    const workspaceRoot = getWorkspaceIdentity();
    return path.join(
      workspaceRoot,
      '.llxprt',
      'extensions',
      extensionName,
      '.env',
    );
  } else {
    // User settings go in extension directory .env
    return path.join(extensionDir, '.env');
  }
}

/**
 * Gets settings values for a specific scope.
 *
 * @param extensionName - Extension name
 * @param extensionDir - Extension directory path
 * @param scope - Setting scope (user or workspace)
 * @returns Promise resolving to record of environment variables
 */
export async function getScopedEnvContents(
  extensionName: string,
  extensionDir: string,
  scope: ExtensionSettingScope,
): Promise<Record<string, string | undefined>> {
  const settings = loadExtensionSettingsFromManifest(extensionDir);

  if (settings.length === 0) {
    return {};
  }

  // Create storage with scope-specific path
  const workspaceRoot = getWorkspaceIdentity();
  const scopedDir =
    scope === ExtensionSettingScope.WORKSPACE
      ? path.join(workspaceRoot, '.llxprt', 'extensions', extensionName)
      : extensionDir;

  const storage = new ExtensionSettingsStorage(extensionName, scopedDir);
  return storage.loadSettings(settings);
}

/**
 * Gets all settings and their values for display purposes.
 * Merges user and workspace scopes, with workspace overriding user.
 * Sensitive settings show '[value stored in keychain]' instead of actual value.
 * Missing settings show '[not set]'.
 *
 * @param extensionName - Extension name
 * @param extensionDir - Extension directory path
 * @param scope - Optional scope to filter by (defaults to merging both)
 * @returns Promise resolving to array of setting display info
 */
export async function getEnvContents(
  extensionName: string,
  extensionDir: string,
  scope?: ExtensionSettingScope,
): Promise<Array<{ name: string; value: string }>> {
  const settings = loadExtensionSettingsFromManifest(extensionDir);

  if (settings.length === 0) {
    return [];
  }

  let settingsValues: Record<string, string | undefined>;

  if (scope) {
    // Load only the specified scope
    settingsValues = await getScopedEnvContents(
      extensionName,
      extensionDir,
      scope,
    );
  } else {
    // Merge user and workspace scopes (workspace overrides user)
    const userValues = await getScopedEnvContents(
      extensionName,
      extensionDir,
      ExtensionSettingScope.USER,
    );
    const workspaceValues = await getScopedEnvContents(
      extensionName,
      extensionDir,
      ExtensionSettingScope.WORKSPACE,
    );
    // Workspace overrides user only for keys that are actually set
    settingsValues = { ...userValues };
    for (const [key, val] of Object.entries(workspaceValues)) {
      if (val !== undefined) {
        settingsValues[key] = val;
      }
    }
  }

  return settings.map((setting) => {
    const value = settingsValues[setting.envVar];
    let displayValue: string;

    if (value === undefined || value === '') {
      displayValue = '[not set]';
    } else if (setting.sensitive) {
      displayValue = '[value stored in keychain]';
    } else {
      displayValue = value;
    }

    return {
      name: setting.name,
      value: displayValue,
    };
  });
}

/**
 * Returns a list of settings that are defined but not configured.
 * Checks both .env files and keychain for sensitive settings.
 */
export async function getMissingSettings(
  extensionName: string,
  extensionDir: string,
): Promise<
  Array<import('@vybestack/llxprt-code-core').ExtensionSetting>
> {
  const settings = loadExtensionSettingsFromManifest(extensionDir);

  if (settings.length === 0) {
    return [];
  }

  // Get existing settings from both scopes
  const existingSettings = await getExtensionEnvironment(extensionDir);
  const missingSettings: Array<
    import('@vybestack/llxprt-code-core').ExtensionSetting
  > = [];

  for (const setting of settings) {
    if (
      existingSettings[setting.envVar] === undefined ||
      existingSettings[setting.envVar] === ''
    ) {
      missingSettings.push(setting);
    }
  }

  return missingSettings;
}

/**
 * Updates a single extension setting.
 *
 * @param extensionName - Extension name
 * @param extensionDir - Extension directory path
 * @param settingKey - Setting name or envVar to update
 * @param requestSetting - Function to prompt user for new value
 * @param scope - Optional scope (defaults to USER)
 * @returns Promise resolving to true if successful
 */
export async function updateSetting(
  extensionName: string,
  extensionDir: string,
  settingKey: string,
  requestSetting: (prompt: string, sensitive: boolean) => Promise<string>,
  scope: ExtensionSettingScope = ExtensionSettingScope.USER,
): Promise<boolean> {
  const settings = loadExtensionSettingsFromManifest(extensionDir);

  // Find the setting by name or envVar
  const setting = settings.find(
    (s) =>
      s.name.toLowerCase() === settingKey.toLowerCase() ||
      s.envVar.toLowerCase() === settingKey.toLowerCase(),
  );

  if (!setting) {
    debugLogger.error(
      `Setting "${settingKey}" not found in extension "${extensionName}".`,
    );
    debugLogger.error('Available settings:');
    settings.forEach((s) => {
      debugLogger.error(`  - ${s.name} (${s.envVar})`);
    });
    return false;
  }

  // Prompt for new value
  const prompt = setting.description
    ? `${setting.name} (${setting.description}): `
    : `${setting.name}: `;
  const newValue = await requestSetting(prompt, setting.sensitive);

  if (newValue === '') {
    debugLogger.log('Update cancelled.');
    return false;
  }

  // Create storage with scope-specific path
  const workspaceRoot = getWorkspaceIdentity();
  const scopedDir =
    scope === ExtensionSettingScope.WORKSPACE
      ? path.join(workspaceRoot, '.llxprt', 'extensions', extensionName)
      : extensionDir;

  const storage = new ExtensionSettingsStorage(extensionName, scopedDir);
  const existingValues = await storage.loadSettings(settings);

  // Update the value
  const updatedValues: Record<string, string> = {};
  for (const s of settings) {
    const existing = existingValues[s.envVar];
    if (existing !== undefined && existing !== '') {
      updatedValues[s.envVar] = existing;
    }
  }
  updatedValues[setting.envVar] = newValue;

  // Ensure directory exists for workspace scope
  if (scope === ExtensionSettingScope.WORKSPACE) {
    await fs.promises.mkdir(scopedDir, { recursive: true });
  }

  // Save all settings
  await storage.saveSettings(settings, updatedValues);

  debugLogger.log(
    `Setting "${setting.name}" updated successfully in ${scope} scope.`,
  );
  return true;
}
