/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';

export const LLXPRT_DIR = '.llxprt';
export const PROVIDER_ACCOUNTS_FILENAME = 'provider_accounts.json';
export const OAUTH_FILE = 'oauth_creds.json';
const TMP_DIR_NAME = 'tmp';

export class Storage {
  private readonly targetDir: string;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
  }

  static getGlobalLlxprtDir(): string {
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

  static getProviderAccountsPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), PROVIDER_ACCOUNTS_FILENAME);
  }

  static getGoogleAccountsPath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'google_accounts.json');
  }

  static getUserCommandsDir(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'commands');
  }

  static getGlobalMemoryFilePath(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'memory.md');
  }

  static getUserPoliciesDir(): string {
    return path.join(Storage.getGlobalLlxprtDir(), 'policies');
  }

  static getSystemSettingsPath(): string {
    if (process.env['LLXPRT_SYSTEM_SETTINGS_PATH']) {
      return process.env['LLXPRT_SYSTEM_SETTINGS_PATH'];
    }
    if (os.platform() === 'darwin') {
      return '/Library/Application Support/LlxprtCode/settings.json';
    } else if (os.platform() === 'win32') {
      return 'C:\\ProgramData\\llxprt-code\\settings.json';
    } else {
      return '/etc/llxprt-code/settings.json';
    }
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
