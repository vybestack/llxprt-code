/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extension settings storage.
 *
 * Stores non-sensitive settings in .env files and sensitive settings
 * in the OS keychain via SecureStore. All keyring access is delegated
 * to SecureStore, eliminating direct @napi-rs/keyring imports.
 *
 * @plan PLAN-20260211-SECURESTORE.P09
 * @requirement R7.5, R7.7
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionSetting } from './extensionSettings.js';
import { SecureStore } from '@vybestack/llxprt-code-core';

/**
 * Returns the path to the .env file for an extension.
 */
export function getSettingsEnvFilePath(extensionDir: string): string {
  return path.join(extensionDir, '.env');
}

/**
 * Returns the keychain service name for an extension.
 * Sanitizes the extension name and limits length to 255 characters.
 */
export function getKeychainServiceName(extensionName: string): string {
  // Remove special characters, keeping only alphanumeric, dash, and underscore
  const sanitized = extensionName.replace(/[^a-zA-Z0-9-_]/g, '');

  // Format: "LLxprt Code Extension {name}"
  const serviceName = `LLxprt Code Extension ${sanitized}`;

  // Limit to 255 characters (common keychain limit)
  return serviceName.substring(0, 255);
}

/**
 * Parses a .env file content into a key-value record.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, equalIndex).trim();
    let value = trimmed.substring(equalIndex + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.substring(1, value.length - 1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Formats a key-value record into .env file format.
 */
function formatEnvFile(values: Record<string, string>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    // Quote values that contain spaces or special characters
    const needsQuotes = /[\s"'\\]/.test(value);
    const formattedValue = needsQuotes
      ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
      : value;
    lines.push(`${key}=${formattedValue}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Storage implementation for extension settings.
 * Stores non-sensitive settings in .env file and sensitive settings
 * via SecureStore (keychain + encrypted file fallback).
 */
export class ExtensionSettingsStorage {
  private readonly extensionDir: string;
  private readonly store: SecureStore;

  constructor(extensionName: string, extensionDir: string) {
    this.extensionDir = extensionDir;
    this.store = new SecureStore(getKeychainServiceName(extensionName));
  }

  /**
   * Saves settings to appropriate storage (env file for non-sensitive, SecureStore for sensitive).
   */
  async saveSettings(
    settings: ExtensionSetting[],
    values: Record<string, string>,
  ): Promise<void> {
    // Ensure directory exists
    await fs.promises.mkdir(this.extensionDir, { recursive: true });

    // Separate sensitive and non-sensitive settings
    const nonSensitiveValues: Record<string, string> = {};
    const sensitiveSettings = settings.filter((s) => s.sensitive);
    const nonSensitiveSettings = settings.filter((s) => !s.sensitive);

    // Collect non-sensitive values for .env file
    for (const setting of nonSensitiveSettings) {
      if (values[setting.envVar] !== undefined) {
        nonSensitiveValues[setting.envVar] = values[setting.envVar];
      }
    }

    // Write non-sensitive settings to .env file (or delete stale file)
    const envPath = getSettingsEnvFilePath(this.extensionDir);
    if (Object.keys(nonSensitiveValues).length > 0) {
      const content = formatEnvFile(nonSensitiveValues);
      await fs.promises.writeFile(envPath, content, 'utf-8');
    } else if (fs.existsSync(envPath)) {
      await fs.promises.unlink(envPath);
    }

    // Write sensitive settings to SecureStore (delete removed ones)
    if (sensitiveSettings.length > 0) {
      for (const setting of sensitiveSettings) {
        const value = values[setting.envVar];
        try {
          if (value !== undefined) {
            await this.store.set(setting.envVar, value);
          } else {
            await this.store.delete(setting.envVar);
          }
        } catch (error) {
          console.error(
            `Failed to persist sensitive setting ${setting.envVar} in keychain:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Loads settings from appropriate storage.
   * Returns a record with undefined for missing settings.
   */
  async loadSettings(
    settings: ExtensionSetting[],
  ): Promise<Record<string, string | undefined>> {
    const result: Record<string, string | undefined> = {};

    // Load non-sensitive settings from .env file
    const envPath = getSettingsEnvFilePath(this.extensionDir);
    let envValues: Record<string, string> = {};

    try {
      if (fs.existsSync(envPath)) {
        const content = await fs.promises.readFile(envPath, 'utf-8');
        envValues = parseEnvFile(content);
      }
    } catch (error) {
      // Handle missing file gracefully
      console.error('Failed to read .env file:', error);
    }

    // Load sensitive settings from SecureStore
    const sensitiveSettings = settings.filter((s) => s.sensitive);
    const nonSensitiveSettings = settings.filter((s) => !s.sensitive);

    // Populate non-sensitive values
    for (const setting of nonSensitiveSettings) {
      result[setting.envVar] = envValues[setting.envVar];
    }

    // Populate sensitive values from SecureStore
    for (const setting of sensitiveSettings) {
      try {
        const value = await this.store.get(setting.envVar);
        result[setting.envVar] = value ?? undefined;
      } catch (error) {
        console.error(
          `Failed to load sensitive setting ${setting.envVar} from keychain:`,
          error,
        );
        result[setting.envVar] = undefined;
      }
    }

    return result;
  }

  /**
   * Deletes all settings (both env file and keychain entries).
   */
  async deleteSettings(): Promise<void> {
    // Delete .env file
    const envPath = getSettingsEnvFilePath(this.extensionDir);
    try {
      if (fs.existsSync(envPath)) {
        await fs.promises.unlink(envPath);
      }
    } catch (error) {
      console.error('Failed to delete .env file:', error);
    }

    // Delete all SecureStore entries for this service
    try {
      const keys = await this.store.list();
      for (const key of keys) {
        try {
          await this.store.delete(key);
        } catch (error) {
          console.error(`Failed to delete keychain entry ${key}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to delete keychain entries:', error);
    }
  }

  /**
   * Checks if any settings exist (env file or keychain entries).
   */
  async hasSettings(): Promise<boolean> {
    // Check for .env file
    const envPath = getSettingsEnvFilePath(this.extensionDir);
    if (fs.existsSync(envPath)) {
      return true;
    }

    // Check for SecureStore entries
    try {
      const keys = await this.store.list();
      return keys.length > 0;
    } catch (error) {
      console.error('Failed to check keychain entries:', error);
    }

    return false;
  }
}
