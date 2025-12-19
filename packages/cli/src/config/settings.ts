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
  FatalConfigError,
  getErrorMessage,
  Storage,
} from '@vybestack/llxprt-code-core';
import stripJsonComments from 'strip-json-comments';
import * as commentJson from 'comment-json';
import { DefaultLight } from '../ui/themes/default-light.js';
import { DefaultDark } from '../ui/themes/default.js';
import { isWorkspaceTrusted, isFolderTrustEnabled } from './trustedFolders.js';
import {
  Settings,
  MemoryImportFormat,
  SETTINGS_SCHEMA,
  SettingDefinition,
} from './settingsSchema.js';
import { resolveEnvVarsInObject } from '../utils/envVarResolver.js';
import {
  SETTINGS_DIRECTORY_NAME,
  USER_SETTINGS_DIR,
  USER_SETTINGS_PATH,
} from './paths.js';

export { USER_SETTINGS_PATH, USER_SETTINGS_DIR, SETTINGS_DIRECTORY_NAME };

export type { Settings, MemoryImportFormat };

export const DEFAULT_EXCLUDED_ENV_VARS = ['DEBUG', 'DEBUG_MODE'];

// Keys that exist at root level but should be migrated to ui.* namespace
// These are read from effectiveSettings.ui.* in config.ts but may exist at root in user settings
const LEGACY_UI_KEYS = [
  'usageStatisticsEnabled',
  'contextFileName',
  'memoryImportFormat',
  'ideMode',
  'hideWindowTitle',
  'showStatusInTitle',
  'hideTips',
  'hideBanner',
  'hideFooter',
  'hideCWD',
  'hideSandboxStatus',
  'hideModelInfo',
  'hideContextSummary',
  'showMemoryUsage',
  'showLineNumbers',
  'showCitations',
  'hasSeenIdeIntegrationNudge',
] as const;

export function getSystemSettingsPath(): string {
  if (process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH) {
    return process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
  }
  if (platform() === 'darwin') {
    return '/Library/Application Support/LLxprt-Code/settings.json';
  } else if (platform() === 'win32') {
    return 'C:\\ProgramData\\llxprt-code\\settings.json';
  } else {
    return '/etc/llxprt-code/settings.json';
  }
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
export type { ToolCallProcessingMode } from './settingsSchema.js';
export type { ToolEnabledState } from './settingsSchema.js';

export enum SettingScope {
  User = 'User',
  Workspace = 'Workspace',
  System = 'System',
  SystemDefaults = 'SystemDefaults',
}

export interface CheckpointingSettings {
  enabled?: boolean;
}

export interface SummarizeToolOutputSettings {
  tokenBudget?: number;
}

export interface AccessibilitySettings {
  disableLoadingPhrases?: boolean;
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

/**
 * Get default values from the settings schema
 */
function getSchemaDefaults(): Partial<Settings> {
  const defaults: Partial<Settings> = {};

  // Helper function to recursively extract defaults from nested schema objects
  function extractDefaults(
    schema: Record<string, SettingDefinition>,
    target: Record<string, unknown>,
  ): void {
    for (const [key, schemaEntry] of Object.entries(schema)) {
      if ('default' in schemaEntry && schemaEntry.default !== undefined) {
        // Skip coreToolSettings default to allow proper merging
        if (key !== 'coreToolSettings') {
          target[key] = schemaEntry.default;
        }
      }

      // Recursively extract defaults from nested object schemas
      if (
        schemaEntry.type === 'object' &&
        'properties' in schemaEntry &&
        schemaEntry.properties
      ) {
        // Initialize nested object if it doesn't exist
        if (!target[key]) {
          target[key] = {};
        }
        extractDefaults(
          schemaEntry.properties as Record<string, SettingDefinition>,
          target[key] as Record<string, unknown>,
        );
      }
    }
  }

  extractDefaults(SETTINGS_SCHEMA, defaults as Record<string, unknown>);

  return defaults;
}

function mergeSettings(
  system: Settings,
  systemDefaults: Settings,
  user: Settings,
  workspace: Settings,
  isTrusted: boolean,
): Settings {
  const safeWorkspace = isTrusted ? workspace : ({} as Settings);

  // Get defaults from schema
  const schemaDefaults = getSchemaDefaults();

  // Helper to extract legacy top-level UI keys from a settings object
  // These keys were at root level in old settings files but are now under ui.*
  const extractLegacyUiKeys = (settings: Settings): Record<string, unknown> => {
    const legacy: Record<string, unknown> = {};
    for (const key of LEGACY_UI_KEYS) {
      if (
        key in settings &&
        settings[key as keyof Settings] !== undefined &&
        !(settings.ui && key in settings.ui)
      ) {
        legacy[key] = settings[key as keyof Settings];
      }
    }
    return legacy;
  };

  // Settings are merged with the following precedence (last one wins for
  // single values):
  // 1. Schema Defaults (from settingsSchema.ts)
  // 2. System Defaults
  // 3. User Settings
  // 4. Workspace Settings
  // 5. System Settings (as overrides)
  //
  // For properties that are arrays (e.g., includeDirectories), arrays
  // are concatenated. For objects (e.g., customThemes), they are merged.
  const merged = {
    ...schemaDefaults,
    ...systemDefaults,
    ...user,
    ...safeWorkspace,
    ...system,
    ui: {
      ...(schemaDefaults.ui || {}),
      // Migrate legacy top-level UI settings to ui.* namespace for backwards compatibility
      // This ensures users with old settings.json files don't lose their preferences
      ...extractLegacyUiKeys(systemDefaults),
      ...(systemDefaults.ui || {}),
      ...extractLegacyUiKeys(user),
      ...(user.ui || {}),
      ...extractLegacyUiKeys(safeWorkspace),
      ...(safeWorkspace.ui || {}),
      ...extractLegacyUiKeys(system),
      ...(system.ui || {}),
      customThemes: {
        ...(systemDefaults.ui?.customThemes || {}),
        ...(user.ui?.customThemes || {}),
        ...(safeWorkspace.ui?.customThemes || {}),
        ...(system.ui?.customThemes || {}),
      },
    },
    mcpServers: {
      ...(systemDefaults.mcpServers || {}),
      ...(user.mcpServers || {}),
      ...(safeWorkspace.mcpServers || {}),
      ...(system.mcpServers || {}),
    },
    includeDirectories: [
      ...(systemDefaults.includeDirectories || []),
      ...(user.includeDirectories || []),
      ...(safeWorkspace.includeDirectories || []),
      ...(system.includeDirectories || []),
    ],
    chatCompression: {
      ...(systemDefaults.chatCompression || {}),
      ...(user.chatCompression || {}),
      ...(safeWorkspace.chatCompression || {}),
      ...(system.chatCompression || {}),
    },
    extensions: {
      ...(systemDefaults.extensions || {}),
      ...(user.extensions || {}),
      ...(safeWorkspace.extensions || {}),
      ...(system.extensions || {}),
      disabled: [
        ...new Set([
          ...(systemDefaults.extensions?.disabled || []),
          ...(user.extensions?.disabled || []),
          ...(safeWorkspace.extensions?.disabled || []),
          ...(system.extensions?.disabled || []),
        ]),
      ],
      workspacesWithMigrationNudge: [
        ...new Set([
          ...(systemDefaults.extensions?.workspacesWithMigrationNudge || []),
          ...(user.extensions?.workspacesWithMigrationNudge || []),
          ...(safeWorkspace.extensions?.workspacesWithMigrationNudge || []),
          ...(system.extensions?.workspacesWithMigrationNudge || []),
        ]),
      ],
    },
    // coreToolSettings is UI-only and should not be merged from settings files
    // It only exists in memory for the UI and manipulates excludeTools/allowedTools
    // But it should have schema defaults for proper UI display
    coreToolSettings: schemaDefaults.coreToolSettings || {},
  };

  const prioritizedTheme =
    safeWorkspace.ui?.theme ??
    user.ui?.theme ??
    system.ui?.theme ??
    systemDefaults.ui?.theme ??
    (schemaDefaults.ui?.theme as string | undefined);
  if (merged.ui) {
    merged.ui.theme = prioritizedTheme;
  }

  return merged;
}

function migrateLegacyInteractiveShellSetting(settings: Settings): void {
  if (!settings || typeof settings !== 'object') {
    return;
  }

  const tools = settings.tools;
  if (!tools || typeof tools !== 'object') {
    return;
  }

  const toolSettings = tools as Record<string, unknown>;
  let legacyValue: boolean | undefined;

  const legacyUsePty = toolSettings['usePty'];
  if (typeof legacyUsePty === 'boolean') {
    legacyValue = legacyUsePty;
    delete toolSettings['usePty'];
  }

  const legacyShell = toolSettings['shell'];
  if (legacyShell && typeof legacyShell === 'object') {
    const shellSettings = legacyShell as Record<string, unknown>;
    const shellFlag = shellSettings['enableInteractiveShell'];
    if (typeof shellFlag === 'boolean') {
      legacyValue = shellFlag;
      delete shellSettings['enableInteractiveShell'];
      if (Object.keys(shellSettings).length === 0) {
        delete toolSettings['shell'];
      }
    }
  }

  if (
    legacyValue !== undefined &&
    typeof settings.shouldUseNodePtyShell !== 'boolean'
  ) {
    settings.shouldUseNodePtyShell = legacyValue;
  }
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

  private _merged: Settings;

  get merged(): Settings {
    return this._merged;
  }

  private computeMergedSettings(): Settings {
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
      if (!settingsFile.settings[topLevel]) {
        (settingsFile.settings as Record<string, unknown>)[topLevel] = {};
      }

      // Navigate to the nested property
      let current = settingsFile.settings[topLevel] as Record<string, unknown>;
      const nestedParts = nested.split('.');
      for (let i = 0; i < nestedParts.length - 1; i++) {
        if (!current[nestedParts[i]]) {
          current[nestedParts[i]] = {};
        }
        current = current[nestedParts[i]] as Record<string, unknown>;
      }
      current[nestedParts[nestedParts.length - 1]] = value;
    } else {
      settingsFile.settings[key as K] = value as Settings[K];
    }

    this._merged = this.computeMergedSettings();
    saveSettings(settingsFile);
  }

  // Provider keyfile methods for llxprt multi-provider support
  getProviderKeyfile(providerName: string): string | undefined {
    const keyfiles = this.merged.providerKeyfiles || {};
    return keyfiles[providerName];
  }

  setProviderKeyfile(providerName: string, keyfilePath: string): void {
    const keyfiles = this.merged.providerKeyfiles || {};
    keyfiles[providerName] = keyfilePath;
    this.setValue(SettingScope.User, 'providerKeyfiles', keyfiles);
  }

  removeProviderKeyfile(providerName: string): void {
    const keyfiles = this.merged.providerKeyfiles || {};
    delete keyfiles[providerName];
    this.setValue(SettingScope.User, 'providerKeyfiles', keyfiles);
  }

  // OAuth enablement methods
  getOAuthEnabledProviders(): Record<string, boolean> {
    return this.merged.oauthEnabledProviders || {};
  }

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
  while (true) {
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
    if (parentDir === currentDir || !parentDir) {
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
        settings?.excludedProjectEnvVars || DEFAULT_EXCLUDED_ENV_VARS;
      const isProjectEnvFile = !envFilePath.includes(LLXPRT_DIR);

      for (const key in parsedEnv) {
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
    } catch (_e) {
      // Errors are ignored to match the behavior of `dotenv.config({ quiet: true })`.
    }
  }
}

/**
 * Loads settings from user and workspace directories.
 * Project settings override user settings.
 */
export function loadSettings(
  workspaceDir: string = process.cwd(),
): LoadedSettings {
  let systemSettings: Settings = {};
  let systemDefaultSettings: Settings = {};
  let userSettings: Settings = {};
  let workspaceSettings: Settings = {};
  const settingsErrors: SettingsError[] = [];
  const systemSettingsPath = getSystemSettingsPath();
  const systemDefaultsPath = getSystemDefaultsPath();

  // Resolve paths to their canonical representation to handle symlinks
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const resolvedHomeDir = path.resolve(homedir());

  let realWorkspaceDir = resolvedWorkspaceDir;
  try {
    // fs.realpathSync gets the "true" path, resolving any symlinks
    realWorkspaceDir = fs.realpathSync(resolvedWorkspaceDir);
  } catch (_e) {
    // This is okay. The path might not exist yet, and that's a valid state.
  }

  // We expect homedir to always exist and be resolvable.
  const realHomeDir = fs.realpathSync(resolvedHomeDir);

  const workspaceSettingsPath = new Storage(
    workspaceDir,
  ).getWorkspaceSettingsPath();

  // Load system settings
  try {
    if (fs.existsSync(systemSettingsPath)) {
      const systemContent = fs.readFileSync(systemSettingsPath, 'utf-8');
      systemSettings = JSON.parse(stripJsonComments(systemContent)) as Settings;
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: systemSettingsPath,
    });
  }

  // Load system defaults
  try {
    if (fs.existsSync(systemDefaultsPath)) {
      const systemDefaultsContent = fs.readFileSync(
        systemDefaultsPath,
        'utf-8',
      );
      const parsedSystemDefaults = JSON.parse(
        stripJsonComments(systemDefaultsContent),
      ) as Settings;
      systemDefaultSettings = resolveEnvVarsInObject(parsedSystemDefaults);
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: systemDefaultsPath,
    });
  }

  // Load user settings
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
      // Support legacy theme names
      if (userSettings.ui?.theme && userSettings.ui.theme === 'VS') {
        userSettings.ui.theme = DefaultLight.name;
      } else if (userSettings.ui?.theme && userSettings.ui.theme === 'VS2015') {
        userSettings.ui.theme = DefaultDark.name;
      }
    }
  } catch (error: unknown) {
    settingsErrors.push({
      message: getErrorMessage(error),
      path: USER_SETTINGS_PATH,
    });
  }

  if (realWorkspaceDir !== realHomeDir) {
    // Load workspace settings
    try {
      if (fs.existsSync(workspaceSettingsPath)) {
        const projectContent = fs.readFileSync(workspaceSettingsPath, 'utf-8');
        workspaceSettings = JSON.parse(
          stripJsonComments(projectContent),
        ) as Settings;
        if (
          workspaceSettings.ui?.theme &&
          workspaceSettings.ui.theme === 'VS'
        ) {
          workspaceSettings.ui.theme = DefaultLight.name;
        } else if (
          workspaceSettings.ui?.theme &&
          workspaceSettings.ui.theme === 'VS2015'
        ) {
          workspaceSettings.ui.theme = DefaultDark.name;
        }
      }
    } catch (error: unknown) {
      settingsErrors.push({
        message: getErrorMessage(error),
        path: workspaceSettingsPath,
      });
    }
  }

  // Check if folder trust feature is enabled in any of the loaded settings
  // before calling isWorkspaceTrusted() to avoid requiring Settings type
  const folderTrustFeature =
    systemSettings.folderTrustFeature ??
    userSettings.folderTrustFeature ??
    false; // default to false per schema

  const folderTrustEnabled =
    systemSettings.folderTrust ?? userSettings.folderTrust ?? true; // default to true per schema logic

  const shouldCheckFolderTrust = folderTrustFeature && folderTrustEnabled;
  // Create a temporary merged settings object for trust checking
  const tempSettingsForTrust = mergeSettings(
    systemSettings,
    systemDefaultSettings,
    userSettings,
    workspaceSettings,
    true, // Assume trusted for this temporary settings object
  );
  const isTrusted = shouldCheckFolderTrust
    ? (isWorkspaceTrusted(tempSettingsForTrust) ?? true)
    : true;

  // Create a temporary merged settings object to pass to loadEnvironment.
  const tempMergedSettings = mergeSettings(
    systemSettings,
    systemDefaultSettings,
    userSettings,
    workspaceSettings,
    isTrusted,
  );

  // loadEnviroment depends on settings so we have to create a temp version of
  // the settings to avoid a cycle
  loadEnvironment(tempMergedSettings);

  // Now that the environment is loaded, resolve variables in the settings.
  systemSettings = resolveEnvVarsInObject(systemSettings);
  userSettings = resolveEnvVarsInObject(userSettings);
  workspaceSettings = resolveEnvVarsInObject(workspaceSettings);

  // Create LoadedSettings first

  if (settingsErrors.length > 0) {
    const errorMessages = settingsErrors.map(
      (error) => `Error in ${error.path}: ${error.message}`,
    );
    throw new FatalConfigError(
      `${errorMessages.join('\n')}\nPlease fix the configuration file(s) and try again.`,
    );
  }

  for (const scopeSettings of [
    systemSettings,
    systemDefaultSettings,
    userSettings,
    workspaceSettings,
  ]) {
    migrateLegacyInteractiveShellSetting(scopeSettings);
  }

  return new LoadedSettings(
    {
      path: systemSettingsPath,
      settings: systemSettings,
    },
    {
      path: systemDefaultsPath,
      settings: systemDefaultSettings,
    },
    {
      path: USER_SETTINGS_PATH,
      settings: userSettings,
    },
    {
      path: workspaceSettingsPath,
      settings: workspaceSettings,
    },
    isTrusted,
  );
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
    console.error('Error saving user settings file:', error);
  }
}
