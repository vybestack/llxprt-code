/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import envPaths from 'env-paths';

export const LLXPRT_DIR = '.llxprt';
export const PROVIDER_ACCOUNTS_FILENAME = 'provider_accounts.json';
export const OAUTH_FILE = 'oauth_creds.json';
const TMP_DIR_NAME = 'tmp';

// Platform-standard paths for llxprt-code (no suffix to match the
// secure-store.ts pattern). Files are split across four XDG-aligned
// categories: config, data, cache, and log/state.
const platformPaths = envPaths('llxprt-code', { suffix: '' });

function resolveSystemSettingsEnv(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (!path.isAbsolute(trimmed)) {
    return undefined;
  }
  return path.resolve(trimmed);
}

/**
 * Resolves an environment-variable override, falling back to a secondary
 * override (for backward compat) and then to the platform default.
 *
 * For example, the data dir checks `LLXPRT_DATA_HOME` first, then falls
 * back to `LLXPRT_CONFIG_HOME` (so existing tests that set one override
 * continue to work), then uses the platform default.
 */
function resolveDir(
  primaryEnv: string,
  fallbackEnv: string | undefined,
  platformDefault: string,
): string {
  const primary = resolveSystemSettingsEnv(process.env[primaryEnv]);
  if (primary !== undefined) {
    return primary;
  }
  if (fallbackEnv !== undefined) {
    const fallback = resolveSystemSettingsEnv(process.env[fallbackEnv]);
    if (fallback !== undefined) {
      return fallback;
    }
  }
  if (!platformDefault) {
    throw new Error('platformDefault must not be empty for resolveDir');
  }
  return platformDefault;
}

export class Storage {
  private readonly targetDir: string;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
  }

  /**
   * Platform-standard directory for user-editable **configuration** files.
   *
   * Override precedence:
   * 1. `LLXPRT_CONFIG_HOME` environment variable
   * 2. `envPaths('llxprt-code').config`
   *
   * Linux: `~/.config/llxprt-code`
   * macOS: `~/Library/Preferences/llxprt-code`
   * Windows: `%APPDATA%\llxprt-code\Config`
   */
  static getGlobalConfigDir(): string {
    return resolveDir('LLXPRT_CONFIG_HOME', undefined, platformPaths.config);
  }

  /**
   * Platform-standard directory for app-managed **data** files (credentials,
   * state, conversations, history).
   *
   * Override precedence:
   * 1. `LLXPRT_DATA_HOME` environment variable
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. `envPaths('llxprt-code').data`
   *
   * Linux: `~/.local/share/llxprt-code`
   * macOS: `~/Library/Application Support/llxprt-code`
   * Windows: `%LOCALAPPDATA%\llxprt-code\Data`
   */
  static getGlobalDataDir(): string {
    return resolveDir(
      'LLXPRT_DATA_HOME',
      'LLXPRT_CONFIG_HOME',
      platformPaths.data,
    );
  }

  /**
   * Platform-standard directory for non-essential **cache** files.
   *
   * Override precedence:
   * 1. `LLXPRT_CACHE_HOME` environment variable
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. `envPaths('llxprt-code').cache`
   *
   * Linux: `~/.cache/llxprt-code`
   * macOS: `~/Library/Caches/llxprt-code`
   * Windows: `%LOCALAPPDATA%\llxprt-code\Cache`
   */
  static getGlobalCacheDir(): string {
    return resolveDir(
      'LLXPRT_CACHE_HOME',
      'LLXPRT_CONFIG_HOME',
      platformPaths.cache,
    );
  }

  /**
   * Platform-standard directory for **log/state** files (debug logs,
   * undo checkpoints, runtime state).
   *
   * Override precedence:
   * 1. `LLXPRT_LOG_HOME` environment variable
   * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
   * 3. `envPaths('llxprt-code').log`
   *
   * Linux: `~/.local/state/llxprt-code`
   * macOS: `~/Library/Logs/llxprt-code`
   * Windows: `%LOCALAPPDATA%\llxprt-code\Log`
   */
  static getGlobalLogDir(): string {
    return resolveDir(
      'LLXPRT_LOG_HOME',
      'LLXPRT_CONFIG_HOME',
      platformPaths.log,
    );
  }

  /**
   * @deprecated Use {@link getGlobalConfigDir} or {@link getGlobalDataDir}
   * instead. Retained as an alias to the config dir for migration purposes.
   * Will be removed once all consumers are updated.
   */
  static getGlobalLlxprtDir(): string {
    return Storage.getGlobalConfigDir();
  }

  /**
   * Returns the legacy global configuration directory (`~/.llxprt`).
   * Used solely by the startup migration logic to detect and copy
   * pre-migration configuration into the new platform-standard paths.
   */
  static getLegacyLlxprtDir(): string {
    const homeDir = os.homedir();
    if (!homeDir) {
      return path.join(os.tmpdir(), '.llxprt');
    }
    return path.join(homeDir, LLXPRT_DIR);
  }

  // ── Config-category paths ───────────────────────────────────────────

  static getGlobalSettingsPath(): string {
    return path.join(Storage.getGlobalConfigDir(), 'settings.json');
  }

  static getUserCommandsDir(): string {
    return path.join(Storage.getGlobalConfigDir(), 'commands');
  }

  static getUserSkillsDir(): string {
    return path.join(Storage.getGlobalConfigDir(), 'skills');
  }

  static getUserPoliciesDir(): string {
    return path.join(Storage.getGlobalConfigDir(), 'policies');
  }

  // ── Data-category paths ─────────────────────────────────────────────

  static getMcpOAuthTokensPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'mcp-oauth-tokens.json');
  }

  static getInstallationIdPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'installation_id');
  }

  static getMachineSecretPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'machine_secret');
  }

  static getProviderAccountsPath(): string {
    return path.join(Storage.getGlobalDataDir(), PROVIDER_ACCOUNTS_FILENAME);
  }

  static getGoogleAccountsPath(): string {
    return path.join(Storage.getGlobalDataDir(), 'google_accounts.json');
  }

  static getOAuthCredsPath(): string {
    return path.join(Storage.getGlobalDataDir(), OAUTH_FILE);
  }

  static getGlobalMemoryFilePath(): string {
    return path.join(Storage.getGlobalDataDir(), 'memory.md');
  }

  // ── System settings (unchanged — system-wide, not user-specific) ────

  static getSystemSettingsPath(): string {
    const sanitized = resolveSystemSettingsEnv(
      process.env['LLXPRT_SYSTEM_SETTINGS_PATH'],
    );
    if (sanitized !== undefined) {
      return sanitized;
    }
    if (os.platform() === 'darwin') {
      return '/Library/Application Support/LlxprtCode/settings.json';
    } else if (os.platform() === 'win32') {
      return 'C:\\ProgramData\\llxprt-code\\settings.json';
    }
    return '/etc/llxprt-code/settings.json';
  }

  static getSystemPoliciesDir(): string {
    return path.join(path.dirname(Storage.getSystemSettingsPath()), 'policies');
  }

  // ── Log/state-category paths ────────────────────────────────────────

  static getGlobalTempDir(): string {
    return path.join(Storage.getGlobalLogDir(), TMP_DIR_NAME);
  }

  getLlxprtDir(): string {
    return path.join(this.targetDir, LLXPRT_DIR);
  }

  getProjectTempDir(): string {
    const hash = this.getFilePathHash(this.getProjectRoot());
    const tempDir = Storage.getGlobalTempDir();
    return path.join(tempDir, hash);
  }

  ensureProjectTempDirExists(): void {
    fs.mkdirSync(this.getProjectTempDir(), { recursive: true });
  }

  getProjectRoot(): string {
    return this.targetDir;
  }

  private getFilePathHash(filePath: string): string {
    return crypto.createHash('sha256').update(filePath).digest('hex');
  }

  getHistoryDir(): string {
    const hash = this.getFilePathHash(this.getProjectRoot());
    const historyDir = path.join(Storage.getGlobalDataDir(), 'history');
    return path.join(historyDir, hash);
  }

  getWorkspaceSettingsPath(): string {
    return path.join(this.getLlxprtDir(), 'settings.json');
  }

  getProjectCommandsDir(): string {
    return path.join(this.getLlxprtDir(), 'commands');
  }

  getProjectSkillsDir(): string {
    return path.join(this.getLlxprtDir(), 'skills');
  }

  getProjectTempCheckpointsDir(): string {
    return path.join(this.getProjectTempDir(), 'checkpoints');
  }

  getExtensionsDir(): string {
    return path.join(this.getLlxprtDir(), 'extensions');
  }

  getExtensionsConfigPath(): string {
    return path.join(this.getExtensionsDir(), 'llxprt-extension.json');
  }

  getHistoryFilePath(): string {
    return path.join(this.getProjectTempDir(), 'shell_history');
  }
}
