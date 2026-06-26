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

// Platform-standard paths for llxprt-code app data (no suffix to match the
// secure-store.ts pattern). Configuration lives under `.data/configuration`
// so that it is a sibling of the secure-store directory.
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

export class Storage {
  private readonly targetDir: string;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
  }

  /**
   * Returns the platform-standard directory for global llxprt configuration
   * and data. Resolves in the following order:
   *
   * 1. `LLXPRT_CONFIG_HOME` environment variable (explicit override)
   * 2. `envPaths('llxprt-code').data` joined with `'configuration'`
   *
   * On macOS this is `~/Library/Application Support/llxprt-code/configuration`,
   * on Linux `~/.local/share/llxprt-code/configuration`, and on Windows
   * `%LOCALAPPDATA%\llxprt-code\configuration`.
   */
  static getGlobalLlxprtDir(): string {
    const sanitized = resolveSystemSettingsEnv(
      process.env['LLXPRT_CONFIG_HOME'],
    );
    if (sanitized !== undefined) {
      return sanitized;
    }
    const dataDir = platformPaths.data;
    if (!dataDir) {
      return path.join(os.tmpdir(), 'llxprt-code', 'configuration');
    }
    return path.join(dataDir, 'configuration');
  }

  /**
   * Returns the legacy global configuration directory (`~/.llxprt`).
   * Used solely by the startup migration logic to detect and copy
   * pre-migration configuration into the new platform-standard path.
   */
  static getLegacyLlxprtDir(): string {
    const homeDir = os.homedir();
    if (!homeDir) {
      return path.join(os.tmpdir(), '.llxprt');
    }
    return path.join(homeDir, LLXPRT_DIR);
  }

  static getMcpOAuthTokensPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'mcp-oauth-tokens.json');
  }

  static getGlobalSettingsPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'settings.json');
  }

  static getInstallationIdPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'installation_id');
  }

  static getMachineSecretPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'machine_secret');
  }

  static getProviderAccountsPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), PROVIDER_ACCOUNTS_FILENAME);
  }

  static getGoogleAccountsPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'google_accounts.json');
  }

  static getUserCommandsDir(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'commands');
  }

  static getUserSkillsDir(): string {
    return path.join(Storage.getGlobalTempDir(), 'skills');
  }

  static getGlobalMemoryFilePath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'memory.md');
  }

  static getUserPoliciesDir(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'policies');
  }

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

  static getGlobalTempDir(): string {
    return path.join(Storage.getGlobalLlxprtDir(), TMP_DIR_NAME);
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

  static getOAuthCredsPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), OAUTH_FILE);
  }

  getProjectRoot(): string {
    return this.targetDir;
  }

  private getFilePathHash(filePath: string): string {
    return crypto.createHash('sha256').update(filePath).digest('hex');
  }

  getHistoryDir(): string {
    const hash = this.getFilePathHash(this.getProjectRoot());
    const historyDir = path.join(Storage.getGlobalLlxprtDir(), 'history');
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
