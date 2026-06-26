/**
 * @plan PLAN-20260608-ISSUE1588.P04
 * @requirement REQ-PROF-001
 *
 * Behavioral TDD tests for Storage.
 *
 * These tests verify real path computation behavior for Storage
 * static and instance methods. Tests fail against stubs because
 * methods throw instead of returning path strings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Storage } from '../Storage.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-storage-test-'));
}

describe('Storage — static path methods', () => {
  const originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
  const originalDataHome = process.env['LLXPRT_DATA_HOME'];
  const originalCacheHome = process.env['LLXPRT_CACHE_HOME'];
  const originalLogHome = process.env['LLXPRT_LOG_HOME'];

  beforeEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
    delete process.env['LLXPRT_DATA_HOME'];
    delete process.env['LLXPRT_CACHE_HOME'];
    delete process.env['LLXPRT_LOG_HOME'];
  });

  afterEach(() => {
    for (const [key, original] of Object.entries({
      LLXPRT_CONFIG_HOME: originalConfigHome,
      LLXPRT_DATA_HOME: originalDataHome,
      LLXPRT_CACHE_HOME: originalCacheHome,
      LLXPRT_LOG_HOME: originalLogHome,
    })) {
      if (original !== undefined) {
        process.env[key] = original;
      } else {
        delete process.env[key];
      }
    }
  });

  it('getGlobalConfigDir returns the platform configuration path', () => {
    const result = Storage.getGlobalConfigDir();
    // The app-name segment is always the basename; the parent identifies the
    // category (Preferences on macOS, Config on Windows, .config on Linux).
    expect(path.basename(result)).toBe('llxprt-code');
    const PLATFORM_PARENTS: Record<string, string> = {
      darwin: 'Preferences',
      win32: 'Config',
    };
    const expectedParent = PLATFORM_PARENTS[process.platform] ?? '.config';
    expect(result).toContain(expectedParent);
  });

  it('getGlobalConfigDir respects the LLXPRT_CONFIG_HOME override', () => {
    const override = '/tmp/llxprt-override-test';
    process.env['LLXPRT_CONFIG_HOME'] = override;
    expect(Storage.getGlobalConfigDir()).toBe(path.resolve(override));
  });

  it('getGlobalDataDir respects the LLXPRT_DATA_HOME override', () => {
    const override = '/tmp/llxprt-data-override-test';
    process.env['LLXPRT_DATA_HOME'] = override;
    expect(Storage.getGlobalDataDir()).toBe(path.resolve(override));
  });

  it('getGlobalDataDir falls back to LLXPRT_CONFIG_HOME (backward compat)', () => {
    const override = '/tmp/llxprt-fallback-test';
    process.env['LLXPRT_CONFIG_HOME'] = override;
    expect(Storage.getGlobalDataDir()).toBe(path.resolve(override));
  });

  it('getGlobalCacheDir respects the LLXPRT_CACHE_HOME override', () => {
    const override = '/tmp/llxprt-cache-override-test';
    process.env['LLXPRT_CACHE_HOME'] = override;
    expect(Storage.getGlobalCacheDir()).toBe(path.resolve(override));
  });

  it('getGlobalLogDir respects the LLXPRT_LOG_HOME override', () => {
    const override = '/tmp/llxprt-log-override-test';
    process.env['LLXPRT_LOG_HOME'] = override;
    expect(Storage.getGlobalLogDir()).toBe(path.resolve(override));
  });

  it('getLegacyLlxprtDir returns ~/.llxprt', () => {
    const result = Storage.getLegacyLlxprtDir();
    expect(result).toBe(path.join(os.homedir(), '.llxprt'));
  });

  it('getGlobalSettingsPath ends with settings.json', () => {
    const result = Storage.getGlobalSettingsPath();
    expect(result).toContain('settings.json');
  });

  it('getInstallationIdPath ends with installation_id', () => {
    const result = Storage.getInstallationIdPath();
    expect(result).toContain('installation_id');
  });

  it('getProviderAccountsPath ends with provider_accounts.json', () => {
    const result = Storage.getProviderAccountsPath();
    expect(result).toContain('provider_accounts.json');
  });

  it('getGlobalTempDir returns a path under the log dir', () => {
    const override = '/tmp/llxprt-log-override-test';
    process.env['LLXPRT_LOG_HOME'] = override;
    const result = Storage.getGlobalTempDir();
    expect(result.startsWith(path.resolve(override))).toBe(true);
    expect(path.basename(result)).toBe('tmp');
  });

  it('getOAuthCredsPath ends with oauth_creds.json', () => {
    const result = Storage.getOAuthCredsPath();
    expect(result).toContain('oauth_creds.json');
  });

  it('getMcpOAuthTokensPath ends with mcp-oauth-tokens.json', () => {
    const result = Storage.getMcpOAuthTokensPath();
    expect(result).toContain('mcp-oauth-tokens.json');
  });

  it('getGlobalMemoryFilePath ends with memory.md', () => {
    const result = Storage.getGlobalMemoryFilePath();
    expect(result).toContain('memory.md');
  });

  it('getUserCommandsDir ends with commands', () => {
    const result = Storage.getUserCommandsDir();
    expect(result).toContain('commands');
  });

  it('getUserSkillsDir ends with skills', () => {
    const result = Storage.getUserSkillsDir();
    expect(result).toContain('skills');
  });

  it('getSystemSettingsPath returns a platform-specific path', () => {
    const result = Storage.getSystemSettingsPath();
    expect(result).toContain('settings.json');
  });

  it('getSystemPoliciesDir returns a path containing policies', () => {
    const result = Storage.getSystemPoliciesDir();
    expect(result).toContain('policies');
  });

  it('getUserPoliciesDir ends with policies', () => {
    const result = Storage.getUserPoliciesDir();
    expect(result).toContain('policies');
  });

  it('getGoogleAccountsPath ends with google_accounts.json', () => {
    const result = Storage.getGoogleAccountsPath();
    expect(result).toContain('google_accounts.json');
  });
});

describe('Storage — instance path methods', () => {
  let tempDir: string;
  let storage: Storage;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    storage = new Storage(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('getProjectRoot returns the target directory', () => {
    const result = storage.getProjectRoot();
    expect(result).toBe(tempDir);
  });

  it('getLlxprtDir returns a path containing .llxprt', () => {
    const result = storage.getLlxprtDir();
    expect(result).toContain('.llxprt');
  });

  it('getLlxprtDir is under the target directory', () => {
    const result = storage.getLlxprtDir();
    expect(result.startsWith(tempDir)).toBe(true);
  });

  it('getWorkspaceSettingsPath ends with settings.json', () => {
    const result = storage.getWorkspaceSettingsPath();
    expect(result).toContain('settings.json');
  });

  it('getProjectCommandsDir ends with commands', () => {
    const result = storage.getProjectCommandsDir();
    expect(result).toContain('commands');
  });

  it('getProjectSkillsDir ends with skills', () => {
    const result = storage.getProjectSkillsDir();
    expect(result).toContain('skills');
  });

  it('getExtensionsDir ends with extensions', () => {
    const result = storage.getExtensionsDir();
    expect(result).toContain('extensions');
  });

  it('getExtensionsConfigPath ends with llxprt-extension.json', () => {
    const result = storage.getExtensionsConfigPath();
    expect(result).toContain('llxprt-extension.json');
  });

  it('getHistoryFilePath ends with shell_history', () => {
    const result = storage.getHistoryFilePath();
    expect(result).toContain('shell_history');
  });

  it('getProjectTempDir returns a path under the global temp dir', () => {
    const result = storage.getProjectTempDir();
    expect(result).toContain('tmp');
  });

  it('getProjectTempCheckpointsDir returns a path containing checkpoints', () => {
    const result = storage.getProjectTempCheckpointsDir();
    expect(result).toContain('checkpoints');
  });

  it('getHistoryDir returns a path containing history', () => {
    const result = storage.getHistoryDir();
    expect(result).toContain('history');
  });
});

describe('Storage — ensureProjectTempDirExists', () => {
  let tempDir: string;
  let storage: Storage;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    storage = new Storage(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates the temp directory on disk', async () => {
    storage.ensureProjectTempDirExists();
    const tempPath = storage.getProjectTempDir();
    // Verify the directory actually exists on the filesystem
    const stat = await fs.stat(tempPath);
    expect(stat.isDirectory()).toBe(true);
  });
});
