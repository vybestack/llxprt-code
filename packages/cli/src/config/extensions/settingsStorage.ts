/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionSetting } from './extensionSettings.js';

interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(
    service: string,
  ): Promise<Array<{ account: string; password: string }>>;
}

let keytarModule: Keytar | null = null;
let keytarLoadAttempted = false;

async function getKeytar(): Promise<Keytar | null> {
  if (keytarLoadAttempted) {
    return keytarModule;
  }

  keytarLoadAttempted = true;

  try {
    const keyring = (await import('@napi-rs/keyring')) as {
      AsyncEntry: new (
        service: string,
        account: string,
      ) => {
        getPassword(): Promise<string | null>;
        setPassword(password: string): Promise<void>;
        deletePassword(): Promise<boolean>;
      };
      findCredentialsAsync: (
        service: string,
      ) => Promise<Array<{ account: string; password: string }>>;
    };
    keytarModule = {
      getPassword: (service: string, account: string) => {
        const entry = new keyring.AsyncEntry(service, account);
        return entry.getPassword();
      },
      setPassword: (service: string, account: string, password: string) => {
        const entry = new keyring.AsyncEntry(service, account);
        return entry.setPassword(password);
      },
      deletePassword: (service: string, account: string) => {
        const entry = new keyring.AsyncEntry(service, account);
        return entry.deletePassword();
      },
      findCredentials: keyring.findCredentialsAsync,
    } as Keytar;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const isModuleMissing =
      err?.code === 'ERR_MODULE_NOT_FOUND' ||
      err?.code === 'MODULE_NOT_FOUND' ||
      err?.code === 'ERR_DLOPEN_FAILED' ||
      err?.message?.includes(`'keytar'`) ||
      err?.message?.includes(`'@napi-rs/keyring'`);

    if (isModuleMissing) {
      console.warn(
        '@napi-rs/keyring not available; sensitive extension settings will not be stored securely.',
      );
    } else {
      console.error('Failed to load @napi-rs/keyring module:', error);
    }

    keytarModule = null;
  }
  return keytarModule;
}

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
 * Stores non-sensitive settings in .env file and sensitive settings in OS keychain.
 */
export class ExtensionSettingsStorage {
  private readonly extensionDir: string;
  private readonly serviceName: string;

  constructor(extensionName: string, extensionDir: string) {
    this.extensionDir = extensionDir;
    this.serviceName = getKeychainServiceName(extensionName);
  }

  /**
   * Saves settings to appropriate storage (env file for non-sensitive, keychain for sensitive).
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

    // Write sensitive settings to keychain (delete removed ones)
    const keytar = await getKeytar();
    if (keytar && sensitiveSettings.length > 0) {
      for (const setting of sensitiveSettings) {
        const value = values[setting.envVar];
        try {
          if (value !== undefined) {
            await keytar.setPassword(this.serviceName, setting.envVar, value);
          } else {
            await keytar.deletePassword(this.serviceName, setting.envVar);
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

    // Load sensitive settings from keychain
    const keytar = await getKeytar();
    const sensitiveSettings = settings.filter((s) => s.sensitive);
    const nonSensitiveSettings = settings.filter((s) => !s.sensitive);

    // Populate non-sensitive values
    for (const setting of nonSensitiveSettings) {
      result[setting.envVar] = envValues[setting.envVar];
    }

    // Populate sensitive values from keychain
    if (keytar) {
      for (const setting of sensitiveSettings) {
        try {
          const value = await keytar.getPassword(
            this.serviceName,
            setting.envVar,
          );
          result[setting.envVar] = value ?? undefined;
        } catch (error) {
          console.error(
            `Failed to load sensitive setting ${setting.envVar} from keychain:`,
            error,
          );
          result[setting.envVar] = undefined;
        }
      }
    } else {
      // Keychain not available, mark sensitive settings as undefined
      for (const setting of sensitiveSettings) {
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

    // Delete all keychain entries for this service
    const keytar = await getKeytar();
    if (keytar) {
      try {
        const credentials = await keytar.findCredentials(this.serviceName);
        for (const cred of credentials) {
          try {
            await keytar.deletePassword(this.serviceName, cred.account);
          } catch (error) {
            console.error(
              `Failed to delete keychain entry ${cred.account}:`,
              error,
            );
          }
        }
      } catch (error) {
        console.error('Failed to delete keychain entries:', error);
      }
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

    // Check for keychain entries
    const keytar = await getKeytar();
    if (keytar) {
      try {
        const credentials = await keytar.findCredentials(this.serviceName);
        return credentials.length > 0;
      } catch (error) {
        console.error('Failed to check keychain entries:', error);
      }
    }

    return false;
  }
}
