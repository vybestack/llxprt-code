/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir, platform } from 'os';
import * as dotenv from 'dotenv';
import process from 'node:process';
import {
  LLXPRT_CONFIG_DIR as LLXPRT_DIR,
  coreEvents,
} from '@vybestack/llxprt-code-core';
import * as commentJson from 'comment-json';
import { isWorkspaceTrusted, isFolderTrustEnabled } from './trustedFolders.js';
import {
  type Settings,
  type MergedSettings,
  type MemoryImportFormat,
} from './settingsSchema.js';
import { mergeSettings } from './settingsMerge.js';
export { loadSettings } from './settingsLoader.js';
export { migrateDeprecatedSettings } from './settingsMigrations.js';
import {
  SETTINGS_DIRECTORY_NAME,
  USER_SETTINGS_DIR,
  USER_SETTINGS_PATH,
} from './paths.js';
export { USER_SETTINGS_PATH, USER_SETTINGS_DIR, SETTINGS_DIRECTORY_NAME };

export type { Settings, MergedSettings, MemoryImportFormat };

/**
 * Creates a fully-initialized MergedSettings object for tests.
 * All sub-objects are guaranteed to be non-nullable.
 */
export function createTestMergedSettings(
  overrides: Partial<Settings> = {},
): MergedSettings {
  return mergeSettings(
    {} as Settings,
    {} as Settings,
    overrides as Settings,
    {} as Settings,
    true,
  );
}

export const DEFAULT_EXCLUDED_ENV_VARS = ['DEBUG', 'DEBUG_MODE'];

export function getSystemSettingsPath(): string {
  if (process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH) {
    return process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
  }
  if (platform() === 'darwin') {
    return '/Library/Application Support/LLxprt-Code/settings.json';
  } else if (platform() === 'win32') {
    return 'C:\\ProgramData\\llxprt-code\\settings.json';
  }
  return '/etc/llxprt-code/settings.json';
}

export function getSystemDefaultsPath(): string {
  if (process.env['LLXPRT_CODE_SYSTEM_DEFAULTS_PATH']) {
    return process.env['LLXPRT_CODE_SYSTEM_DEFAULTS_PATH'];
  }
  return path.join(
    path.dirname(getSystemSettingsPath()),
    'system-defaults.json',
  );
}

export type { DnsResolutionOrder } from './settingsSchema.js';
export type { ToolEnabledState } from './settingsSchema.js';

export enum SettingScope {
  User = 'User',
  Workspace = 'Workspace',
  System = 'System',
  SystemDefaults = 'SystemDefaults',
  Session = 'Session',
}

export type LoadableSettingScope =
  | SettingScope.User
  | SettingScope.Workspace
  | SettingScope.System;

export function isLoadableSettingScope(
  scope: SettingScope,
): scope is LoadableSettingScope {
  return (
    scope === SettingScope.User ||
    scope === SettingScope.Workspace ||
    scope === SettingScope.System
  );
}

export interface CheckpointingSettings {
  enabled?: boolean;
}

export interface SummarizeToolOutputSettings {
  tokenBudget?: number;
}

export interface AccessibilitySettings {
  enableLoadingPhrases?: boolean;
  screenReader?: boolean;
}

export interface SessionRetentionSettings {
  /** Enable automatic session cleanup */
  enabled?: boolean;

  /** Maximum age of sessions to keep (e.g., "30d", "7d", "24h", "1w") */
  maxAge?: string;

  /** Alternative: Maximum number of sessions to keep (most recent) */
  maxCount?: number;

  /** Minimum retention period (safety limit, defaults to "1d") */
  minRetention?: string;
}

export interface SettingsError {
  message: string;
  path: string;
}

export interface SettingsFile {
  settings: Settings;
  path: string;
}

export class LoadedSettings {
  constructor(
    system: SettingsFile,
    systemDefaults: SettingsFile,
    user: SettingsFile,
    workspace: SettingsFile,
    isTrusted: boolean,
  ) {
    this.system = system;
    this.systemDefaults = systemDefaults;
    this.user = user;
    this.workspace = workspace;
    this.isTrusted = isTrusted;
    this._merged = this.computeMergedSettings();
    this.errors = []; // No errors if we got here, they would have thrown
  }

  readonly system: SettingsFile;
  readonly systemDefaults: SettingsFile;
  readonly user: SettingsFile;
  readonly workspace: SettingsFile;
  readonly isTrusted: boolean;
  readonly errors: SettingsError[] = [];

  private _merged: MergedSettings;

  get merged(): MergedSettings {
    return this._merged;
  }

  private computeMergedSettings(): MergedSettings {
    return mergeSettings(
      this.system.settings,
      this.systemDefaults.settings,
      this.user.settings,
      this.workspace.settings,
      this.isTrusted,
    );
  }

  forScope(scope: SettingScope): SettingsFile {
    switch (scope) {
      case SettingScope.User:
        return this.user;
      case SettingScope.Workspace:
        return this.workspace;
      case SettingScope.System:
        return this.system;
      case SettingScope.SystemDefaults:
        return this.systemDefaults;
      default:
        throw new Error(`Invalid scope: ${scope}`);
    }
  }

  setValue<K extends keyof Settings>(
    scope: SettingScope,
    key: K | string,
    value: Settings[K] | unknown,
  ): void {
    const settingsFile = this.forScope(scope);

    // Handle nested paths like 'ui.ideMode'
    if (typeof key === 'string' && key.includes('.')) {
      const parts = key.split('.');
      const topLevel = parts[0] as keyof Settings;
      const nested = parts.slice(1).join('.');

      // Ensure the top-level object exists
      const settingsRecord = settingsFile.settings as Record<string, unknown>;
      const existingTopLevel = settingsRecord[topLevel];
      if (typeof existingTopLevel !== 'object' || existingTopLevel === null) {
        settingsRecord[topLevel] = {};
      }

      // Navigate to the nested property
      let current = settingsRecord[topLevel] as Record<string, unknown>;
      const nestedParts = nested.split('.');
      for (let i = 0; i < nestedParts.length - 1; i++) {
        current[nestedParts[i]] ??= {};
        current = current[nestedParts[i]] as Record<string, unknown>;
      }
      current[nestedParts[nestedParts.length - 1]] = value;
    } else {
      settingsFile.settings[key as K] = value as Settings[K];
    }

    this._merged = this.computeMergedSettings();
    saveSettings(settingsFile);
    coreEvents.emitSettingsChanged();
  }

  // Provider keyfile methods for llxprt multi-provider support
  getProviderKeyfile(providerName: string): string | undefined {
    const keyfiles = this.merged.providerKeyfiles ?? {};
    return keyfiles[providerName];
  }

  setProviderKeyfile(providerName: string, keyfilePath: string): void {
    const keyfiles = this.merged.providerKeyfiles ?? {};
    keyfiles[providerName] = keyfilePath;
    this.setValue(SettingScope.User, 'providerKeyfiles', keyfiles);
  }

  removeProviderKeyfile(providerName: string): void {
    const keyfiles = this.merged.providerKeyfiles ?? {};
    delete keyfiles[providerName];
    this.setValue(SettingScope.User, 'providerKeyfiles', keyfiles);
  }

  // OAuth enablement methods
  getOAuthEnabledProviders(): Record<string, boolean> {
    return this.merged.oauthEnabledProviders ?? {};
  }

  // Note: setRemoteAdminSettings from upstream omitted - not applicable to LLxprt (no Google admin integration)

  setOAuthEnabledProvider(providerName: string, enabled: boolean): void {
    const oauthEnabledProviders = this.getOAuthEnabledProviders();
    oauthEnabledProviders[providerName] = enabled;
    this.setValue(
      SettingScope.User,
      'oauthEnabledProviders',
      oauthEnabledProviders,
    );
  }

  isOAuthEnabledForProvider(providerName: string): boolean {
    const oauthEnabledProviders = this.getOAuthEnabledProviders();
    return oauthEnabledProviders[providerName] ?? false;
  }
}

function findEnvFile(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  for (;;) {
    // prefer gemini-specific .env under LLXPRT_DIR
    const geminiEnvPath = path.join(currentDir, LLXPRT_DIR, '.env');
    if (fs.existsSync(geminiEnvPath)) {
      return geminiEnvPath;
    }
    const envPath = path.join(currentDir, '.env');
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // check .env under home as fallback, again preferring gemini-specific .env
      const homeGeminiEnvPath = path.join(homedir(), LLXPRT_DIR, '.env');
      if (fs.existsSync(homeGeminiEnvPath)) {
        return homeGeminiEnvPath;
      }
      const homeEnvPath = path.join(homedir(), '.env');
      if (fs.existsSync(homeEnvPath)) {
        return homeEnvPath;
      }
      return null;
    }
    currentDir = parentDir;
  }
}

export function setUpCloudShellEnvironment(envFilePath: string | null): void {
  // Special handling for GOOGLE_CLOUD_PROJECT in Cloud Shell:
  // Because GOOGLE_CLOUD_PROJECT in Cloud Shell tracks the project
  // set by the user using "gcloud config set project" we do not want to
  // use its value. So, unless the user overrides GOOGLE_CLOUD_PROJECT in
  // one of the .env files, we set the Cloud Shell-specific default here.
  if (envFilePath && fs.existsSync(envFilePath)) {
    const envFileContent = fs.readFileSync(envFilePath);
    const parsedEnv = dotenv.parse(envFileContent);
    if (parsedEnv.GOOGLE_CLOUD_PROJECT) {
      // .env file takes precedence in Cloud Shell
      process.env.GOOGLE_CLOUD_PROJECT = parsedEnv.GOOGLE_CLOUD_PROJECT;
    } else {
      // If not in .env, set to default and override global
      process.env.GOOGLE_CLOUD_PROJECT = 'cloudshell-gca';
    }
  } else {
    // If no .env file, set to default and override global
    process.env.GOOGLE_CLOUD_PROJECT = 'cloudshell-gca';
  }
}

export function loadEnvironment(settings: Settings): void {
  const envFilePath = findEnvFile(process.cwd());

  // Check if folder trust feature is enabled, and if so, check if workspace is trusted
  if (isFolderTrustEnabled(settings)) {
    const trusted = isWorkspaceTrusted(settings);
    if (trusted !== true) {
      // If not explicitly trusted (false or undefined), don't load environment
      return;
    }
  }

  // Cloud Shell environment variable handling
  if (process.env.CLOUD_SHELL === 'true') {
    setUpCloudShellEnvironment(envFilePath);
  }

  if (envFilePath) {
    // Manually parse and load environment variables to handle exclusions correctly.
    // This avoids modifying environment variables that were already set from the shell.
    try {
      const envFileContent = fs.readFileSync(envFilePath, 'utf-8');
      const parsedEnv = dotenv.parse(envFileContent);

      const excludedVars =
        settings.excludedProjectEnvVars ?? DEFAULT_EXCLUDED_ENV_VARS;
      const isProjectEnvFile = !envFilePath.includes(LLXPRT_DIR);

      for (const key in parsedEnv) {
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (Object.hasOwn(parsedEnv, key)) {
          // If it's a project .env file, skip loading excluded variables.
          if (isProjectEnvFile && excludedVars.includes(key)) {
            continue;
          }

          // Load variable only if it's not already set in the environment.
          if (!Object.hasOwn(process.env, key)) {
            process.env[key] = parsedEnv[key];
          }
        }
      }
    } catch {
      // Errors are ignored to match the behavior of `dotenv.config({ quiet: true })`.
    }
  }
}

function deepMergeWithComments(target: unknown, source: unknown): unknown {
  if (
    typeof target !== 'object' ||
    target === null ||
    typeof source !== 'object' ||
    source === null
  ) {
    return source;
  }

  if (Array.isArray(source)) {
    return source;
  }

  const result = target as Record<string, unknown>;
  const sourceObj = source as Record<string, unknown>;

  // Add or update keys from source
  Object.keys(sourceObj).forEach((key) => {
    if (
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof sourceObj[key] === 'object' &&
      sourceObj[key] !== null &&
      !Array.isArray(sourceObj[key])
    ) {
      result[key] = deepMergeWithComments(result[key], sourceObj[key]);
    } else {
      result[key] = sourceObj[key];
    }
  });

  // Remove keys that are not in source
  Object.keys(result).forEach((key) => {
    if (!(key in sourceObj)) {
      delete result[key];
    }
  });

  return result;
}

export function saveSettings(settingsFile: SettingsFile): void {
  try {
    // Ensure the directory exists
    const dirPath = path.dirname(settingsFile.path);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Read the original file to preserve comments
    let outputContent: string;
    if (fs.existsSync(settingsFile.path)) {
      const originalContent = fs.readFileSync(settingsFile.path, 'utf-8');
      try {
        // Parse with comments preserved
        const parsedWithComments = commentJson.parse(originalContent);
        // Deep merge to preserve comments at all levels
        const merged = deepMergeWithComments(
          parsedWithComments,
          settingsFile.settings,
        );
        outputContent = commentJson.stringify(merged, null, 2);
      } catch {
        // If parsing with comments fails, fall back to regular JSON
        outputContent = JSON.stringify(settingsFile.settings, null, 2);
      }
    } else {
      // New file, no comments to preserve
      outputContent = JSON.stringify(settingsFile.settings, null, 2);
    }

    fs.writeFileSync(settingsFile.path, outputContent, 'utf-8');
  } catch (error) {
    coreEvents.emitFeedback(
      'error',
      'There was an error saving your latest settings changes.',
      error,
    );
  }
}
