/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
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
      console.error(
        `Invalid settings schema in ${manifestPath}:`,
        validationResult.error,
      );
      return [];
    }

    return validationResult.data;
  } catch (error) {
    // Handle JSON parse errors or file read errors
    console.error(
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

  // Read .env file for non-sensitive settings
  const envFilePath = path.join(extensionDir, '.env');

  if (fs.existsSync(envFilePath)) {
    try {
      const envContent = fs.readFileSync(envFilePath, 'utf-8');
      const parsed = dotenv.parse(envContent);
      Object.assign(result, parsed);
    } catch (error) {
      console.error(`Failed to read .env file at ${envFilePath}:`, error);
    }
  }

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
      console.error(`Failed to read extension name from manifest:`, error);
    }
  }

  if (!extensionName) {
    return result;
  }

  // Load settings from storage (including keychain)
  const storage = new ExtensionSettingsStorage(extensionName, extensionDir);
  const settingsValues = await storage.loadSettings(settings);

  // Merge non-undefined values into result
  for (const [key, value] of Object.entries(settingsValues)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
