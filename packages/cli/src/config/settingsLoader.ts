import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { FatalConfigError, getErrorMessage } from '@vybestack/llxprt-code-core';
import {
  Storage,
  migrateLegacySettingKeys,
} from '@vybestack/llxprt-code-settings';
import stripJsonComments from 'strip-json-comments';
import { DefaultLight } from '../ui/themes/default-light.js';
import { DefaultDark } from '../ui/themes/default.js';
import { isWorkspaceTrusted } from './trustedFolders.js';
import type { Settings } from './settingsSchema.js';
import { resolveEnvVarsInObject } from '../utils/envVarResolver.js';
import { USER_SETTINGS_PATH } from './paths.js';
import { mergeSettings } from './settingsMerge.js';
import { formatConfigFileErrors } from './configError.js';
import {
  migrateHooksConfig,
  migrateLegacyInteractiveShellSetting,
} from './settingsLegacy.js';
import { migrateDeprecatedSettings } from './settingsMigrations.js';
import {
  getSystemDefaultsPath,
  getSystemSettingsPath,
  LoadedSettings,
  loadEnvironment,
  type SettingsError,
} from './settings.js';
import {
  validateSettings,
  formatValidationError,
} from './settings-validation.js';

type SettingsState = {
  system: Settings;
  systemDefaults: Settings;
  user: Settings;
  workspace: Settings;
};

type SettingsPaths = {
  system: string;
  systemDefaults: string;
  user: string;
  workspace: string;
};

function validateSettingsOrThrow(
  settingsObject: unknown,
  filePath: string,
): void {
  const validationResult = validateSettings(settingsObject);
  if (!validationResult.success && validationResult.error) {
    throw new FatalConfigError(
      formatValidationError(validationResult.error, filePath),
    );
  }
}

function normalizeLegacyTheme(settings: Settings): void {
  if (settings.ui?.theme === 'VS') {
    settings.ui.theme = DefaultLight.name;
  } else if (settings.ui?.theme === 'VS2015') {
    settings.ui.theme = DefaultDark.name;
  }
}

function readSettingsFile(filePath: string, resolveEnv = false): Settings {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(stripJsonComments(content)) as Settings;
  return resolveEnv ? resolveEnvVarsInObject(parsed) : parsed;
}

function captureSettingsError(
  errors: SettingsError[],
  path: string,
  error: unknown,
): void {
  if (error instanceof FatalConfigError) {
    throw error;
  }
  errors.push({ message: getErrorMessage(error), path });
}

function loadOptionalSettingsFile(
  filePath: string,
  errors: SettingsError[],
  options: { resolveEnv?: boolean; legacyTheme?: boolean } = {},
): Settings {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const settings = readSettingsFile(filePath, options.resolveEnv === true);
    if (options.legacyTheme === true) {
      normalizeLegacyTheme(settings);
    }
    validateSettingsOrThrow(settings, filePath);
    return settings;
  } catch (error: unknown) {
    captureSettingsError(errors, filePath, error);
    return {};
  }
}

function resolveRealWorkspaceDir(workspaceDir: string): string | undefined {
  try {
    return fs.realpathSync(path.resolve(workspaceDir));
  } catch {
    return undefined;
  }
}

function loadSettingsFiles(
  workspaceDir: string,
  paths: SettingsPaths,
): {
  settings: SettingsState;
  errors: SettingsError[];
  realWorkspaceDir: string | undefined;
  realHomeDir: string;
} {
  const errors: SettingsError[] = [];
  const realWorkspaceDir = resolveRealWorkspaceDir(workspaceDir);
  const realHomeDir = fs.realpathSync(path.resolve(homedir()));
  const system = loadOptionalSettingsFile(paths.system, errors);
  const systemDefaults = loadOptionalSettingsFile(
    paths.systemDefaults,
    errors,
    {
      resolveEnv: true,
    },
  );
  const user = loadOptionalSettingsFile(paths.user, errors, {
    legacyTheme: true,
  });
  const workspace =
    realWorkspaceDir === undefined || realWorkspaceDir === realHomeDir
      ? {}
      : loadOptionalSettingsFile(paths.workspace, errors, {
          legacyTheme: true,
        });
  return {
    errors,
    realWorkspaceDir,
    realHomeDir,
    settings: { system, systemDefaults, user, workspace },
  };
}

function shouldCheckFolderTrust(settings: SettingsState): boolean {
  const folderTrustFeature =
    settings.system.folderTrustFeature ??
    settings.user.folderTrustFeature ??
    false;
  const folderTrustEnabled =
    settings.system.folderTrust ?? settings.user.folderTrust ?? true;
  return folderTrustFeature && folderTrustEnabled;
}

function resolveTrustedState(
  settings: SettingsState,
  workspaceDir: string | undefined,
): boolean {
  const tempSettingsForTrust = mergeSettings(
    settings.system,
    settings.systemDefaults,
    settings.user,
    settings.workspace,
    true,
  );
  if (!shouldCheckFolderTrust(settings)) {
    return true;
  }
  return workspaceDir === undefined
    ? false
    : (isWorkspaceTrusted(tempSettingsForTrust, workspaceDir) ?? false);
}

function loadEnvironmentAndResolveSettings(
  settings: SettingsState,
  isTrusted: boolean,
): SettingsState {
  const tempMergedSettings = mergeSettings(
    settings.system,
    settings.systemDefaults,
    settings.user,
    settings.workspace,
    isTrusted,
  );
  loadEnvironment(tempMergedSettings);
  return {
    system: resolveEnvVarsInObject(settings.system),
    systemDefaults: settings.systemDefaults,
    user: resolveEnvVarsInObject(settings.user),
    workspace: resolveEnvVarsInObject(settings.workspace),
  };
}

function throwSettingsErrors(errors: SettingsError[]): void {
  if (errors.length === 0) {
    return;
  }
  throw new FatalConfigError(formatConfigFileErrors(errors));
}

function migrateLoadedSettings(settings: SettingsState): void {
  for (const scopeSettings of [
    settings.system,
    settings.systemDefaults,
    settings.user,
    settings.workspace,
  ]) {
    migrateLegacyInteractiveShellSetting(scopeSettings);
    migrateHooksConfig(scopeSettings);
    // #2533 Phase C1: rewrite legacy setting-key spellings once at load,
    // in memory, exactly like the migrations above (no immediate rewrite of
    // the on-disk file). Provider blocks are permissive maps where legacy
    // model-param spellings (e.g. 'max-tokens') actually live, so they are
    // migrated too.
    if (!isPlainRecord(scopeSettings)) {
      continue;
    }
    const scopeRecord: Record<string, unknown> = scopeSettings;
    const migrated = migrateLegacySettingKeys(scopeRecord);
    if (migrated !== scopeRecord) {
      applyMigratedScopeKeys(scopeRecord, migrated);
    }
    const providers = scopeRecord['providers'];
    if (isPlainRecord(providers)) {
      for (const provider of Object.values(providers)) {
        migrateProviderBlock(provider);
      }
    }
  }
}

function migrateProviderBlock(provider: unknown): void {
  if (!isPlainRecord(provider)) {
    return;
  }
  const migratedProvider = migrateLegacySettingKeys(provider);
  if (migratedProvider !== provider) {
    applyMigratedScopeKeys(provider, migratedProvider);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copies migrated key/value pairs back into the original scope object
 * in place (the scope objects are referenced elsewhere), removing keys the
 * migration deleted.
 */
function applyMigratedScopeKeys(
  target: Record<string, unknown>,
  migrated: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) {
    if (!(key in migrated)) {
      delete target[key];
    }
  }
  for (const [key, value] of Object.entries(migrated)) {
    target[key] = value;
  }
}

function createLoadedSettings(
  paths: SettingsPaths,
  settings: SettingsState,
  isTrusted: boolean,
): LoadedSettings {
  return new LoadedSettings(
    { path: paths.system, settings: settings.system },
    { path: paths.systemDefaults, settings: settings.systemDefaults },
    { path: paths.user, settings: settings.user },
    { path: paths.workspace, settings: settings.workspace },
    isTrusted,
  );
}

export function loadSettings(
  workspaceDir: string = process.cwd(),
): LoadedSettings {
  const paths: SettingsPaths = {
    system: getSystemSettingsPath(),
    systemDefaults: getSystemDefaultsPath(),
    user: USER_SETTINGS_PATH,
    workspace: new Storage(workspaceDir).getWorkspaceSettingsPath(),
  };
  const loaded = loadSettingsFiles(workspaceDir, paths);
  const isTrusted = resolveTrustedState(
    loaded.settings,
    loaded.realWorkspaceDir,
  );
  const settings = loadEnvironmentAndResolveSettings(
    loaded.settings,
    isTrusted,
  );
  throwSettingsErrors(loaded.errors);
  migrateLoadedSettings(settings);
  const loadedSettings = createLoadedSettings(paths, settings, isTrusted);
  migrateDeprecatedSettings(loadedSettings);
  return loadedSettings;
}
