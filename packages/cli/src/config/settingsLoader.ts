import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import {
  FatalConfigError,
  getErrorMessage,
  Storage,
} from '@vybestack/llxprt-code-core';
import stripJsonComments from 'strip-json-comments';
import { DefaultLight } from '../ui/themes/default-light.js';
import { DefaultDark } from '../ui/themes/default.js';
import { isWorkspaceTrusted } from './trustedFolders.js';
import type { Settings } from './settingsSchema.js';
import { resolveEnvVarsInObject } from '../utils/envVarResolver.js';
import { USER_SETTINGS_PATH } from './paths.js';
import { mergeSettings } from './settingsMerge.js';
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

function resolveRealWorkspaceDir(workspaceDir: string): string {
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  try {
    return fs.realpathSync(resolvedWorkspaceDir);
  } catch {
    return resolvedWorkspaceDir;
  }
}

function loadSettingsFiles(
  workspaceDir: string,
  paths: SettingsPaths,
): {
  settings: SettingsState;
  errors: SettingsError[];
  realWorkspaceDir: string;
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
    realWorkspaceDir === realHomeDir
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

function resolveTrustedState(settings: SettingsState): boolean {
  const tempSettingsForTrust = mergeSettings(
    settings.system,
    settings.systemDefaults,
    settings.user,
    settings.workspace,
    true,
  );
  return shouldCheckFolderTrust(settings)
    ? (isWorkspaceTrusted(tempSettingsForTrust) ?? true)
    : true;
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
  const errorMessages = errors.map(
    (error) => `Error in ${error.path}: ${error.message}`,
  );
  throw new FatalConfigError(
    `${errorMessages.join('\n')}\nPlease fix the configuration file(s) and try again.`,
  );
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
  const isTrusted = resolveTrustedState(loaded.settings);
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
