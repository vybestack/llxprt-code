/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'node:path';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

import {
  Storage,
  LLXPRT_DIR,
  PROVIDER_ACCOUNTS_FILENAME,
  OAUTH_FILE,
} from './storage.js';

/**
 * Returns the expected path segment for the current platform, avoiding
 * nested ternary expressions that trigger sonarjs/no-nested-conditional.
 */
function platformSegment(darwin: string, win32: string, linux: string): string {
  const platform = os.platform();
  if (platform === 'darwin') return darwin;
  if (platform === 'win32') return win32;
  return linux;
}

const expectedDefaultSystemSettingsPath = (): string => {
  if (os.platform() === 'darwin') {
    return '/Library/Application Support/LlxprtCode/settings.json';
  }
  if (os.platform() === 'win32') {
    return 'C:\\ProgramData\\llxprt-code\\settings.json';
  }
  return '/etc/llxprt-code/settings.json';
};

// ---------------------------------------------------------------------------
// P02b RED gate – path / storage constant assertions
// These must fail against the P02a stub (empty-string constants) and pass
// once real values are provided in the implementation phase.
// ---------------------------------------------------------------------------

describe('Path / storage constants', () => {
  it('LLXPRT_DIR is ".llxprt"', () => {
    expect(LLXPRT_DIR).toBe('.llxprt');
  });

  it('PROVIDER_ACCOUNTS_FILENAME is "provider_accounts.json"', () => {
    expect(PROVIDER_ACCOUNTS_FILENAME).toBe('provider_accounts.json');
  });

  it('OAUTH_FILE is "oauth_creds.json"', () => {
    expect(OAUTH_FILE).toBe('oauth_creds.json');
  });
});

// Override dirs (one per category). Setting the category-specific override
// makes the dir diverge from the others; setting only LLXPRT_CONFIG_HOME makes
// all four resolve to the same path (backward-compat behavior).
const OVERRIDE_DIR = path.join(os.tmpdir(), 'llxprt-test-config-home');
const DATA_OVERRIDE_DIR = path.join(os.tmpdir(), 'llxprt-test-data-home');
const CACHE_OVERRIDE_DIR = path.join(os.tmpdir(), 'llxprt-test-cache-home');
const LOG_OVERRIDE_DIR = path.join(os.tmpdir(), 'llxprt-test-log-home');

// Snapshot/restore every env var touched by these tests so they cannot leak
// into other suites.
const ENV_KEYS = [
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

describe('Storage – category dir override resolution', () => {
  beforeEach(() => {
    // Only the config override is set; the other three should fall back to it.
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    delete process.env['LLXPRT_DATA_HOME'];
    delete process.env['LLXPRT_CACHE_HOME'];
    delete process.env['LLXPRT_LOG_HOME'];
  });

  afterEach(restoreEnv);

  it('getGlobalConfigDir respects LLXPRT_CONFIG_HOME override', () => {
    expect(Storage.getGlobalConfigDir()).toBe(OVERRIDE_DIR);
  });

  it('getGlobalDataDir falls back to LLXPRT_CONFIG_HOME (backward compat)', () => {
    expect(Storage.getGlobalDataDir()).toBe(OVERRIDE_DIR);
  });

  it('getGlobalCacheDir falls back to LLXPRT_CONFIG_HOME (backward compat)', () => {
    expect(Storage.getGlobalCacheDir()).toBe(OVERRIDE_DIR);
  });

  it('getGlobalLogDir falls back to LLXPRT_CONFIG_HOME (backward compat)', () => {
    expect(Storage.getGlobalLogDir()).toBe(OVERRIDE_DIR);
  });

  it('deprecated getGlobalLlxprtDir delegates to getGlobalConfigDir', () => {
    expect(Storage.getGlobalLlxprtDir()).toBe(Storage.getGlobalConfigDir());
  });
});

describe('Storage – category-specific overrides take precedence', () => {
  beforeEach(() => {
    // Set the config override AND each category-specific override so the four
    // dirs diverge.
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    process.env['LLXPRT_DATA_HOME'] = DATA_OVERRIDE_DIR;
    process.env['LLXPRT_CACHE_HOME'] = CACHE_OVERRIDE_DIR;
    process.env['LLXPRT_LOG_HOME'] = LOG_OVERRIDE_DIR;
  });

  afterEach(restoreEnv);

  it('getGlobalConfigDir ignores other category overrides', () => {
    expect(Storage.getGlobalConfigDir()).toBe(OVERRIDE_DIR);
  });

  it('getGlobalDataDir prefers LLXPRT_DATA_HOME over LLXPRT_CONFIG_HOME', () => {
    expect(Storage.getGlobalDataDir()).toBe(DATA_OVERRIDE_DIR);
  });

  it('getGlobalCacheDir prefers LLXPRT_CACHE_HOME over LLXPRT_CONFIG_HOME', () => {
    expect(Storage.getGlobalCacheDir()).toBe(CACHE_OVERRIDE_DIR);
  });

  it('getGlobalLogDir prefers LLXPRT_LOG_HOME over LLXPRT_CONFIG_HOME', () => {
    expect(Storage.getGlobalLogDir()).toBe(LOG_OVERRIDE_DIR);
  });
});

describe('Storage – config-category methods resolve under config dir', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    process.env['LLXPRT_DATA_HOME'] = DATA_OVERRIDE_DIR;
    process.env['LLXPRT_CACHE_HOME'] = CACHE_OVERRIDE_DIR;
    process.env['LLXPRT_LOG_HOME'] = LOG_OVERRIDE_DIR;
  });

  afterEach(restoreEnv);

  it('getGlobalSettingsPath returns <configDir>/settings.json', () => {
    expect(Storage.getGlobalSettingsPath()).toBe(
      path.join(OVERRIDE_DIR, 'settings.json'),
    );
  });

  it('getUserCommandsDir returns <configDir>/commands', () => {
    expect(Storage.getUserCommandsDir()).toBe(
      path.join(OVERRIDE_DIR, 'commands'),
    );
  });

  it('getUserSkillsDir returns <configDir>/skills (NOT under log/tmp dir)', () => {
    const result = Storage.getUserSkillsDir();
    expect(result).toBe(path.join(OVERRIDE_DIR, 'skills'));
    // Skills must live under the config dir, not the log dir (which holds tmp).
    expect(result.startsWith(OVERRIDE_DIR)).toBe(true);
    expect(result.startsWith(LOG_OVERRIDE_DIR)).toBe(false);
  });

  it('getUserPoliciesDir returns <configDir>/policies', () => {
    expect(Storage.getUserPoliciesDir()).toBe(
      path.join(OVERRIDE_DIR, 'policies'),
    );
  });
});

describe('Storage – data-category methods resolve under data dir', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    process.env['LLXPRT_DATA_HOME'] = DATA_OVERRIDE_DIR;
    process.env['LLXPRT_CACHE_HOME'] = CACHE_OVERRIDE_DIR;
    process.env['LLXPRT_LOG_HOME'] = LOG_OVERRIDE_DIR;
  });

  afterEach(restoreEnv);

  it('getMcpOAuthTokensPath returns <dataDir>/mcp-oauth-tokens.json', () => {
    expect(Storage.getMcpOAuthTokensPath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'mcp-oauth-tokens.json'),
    );
  });

  it('getInstallationIdPath returns <dataDir>/installation_id', () => {
    expect(Storage.getInstallationIdPath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'installation_id'),
    );
  });

  it('getMachineSecretPath returns <dataDir>/machine_secret', () => {
    expect(Storage.getMachineSecretPath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'machine_secret'),
    );
  });

  it('getProviderAccountsPath returns <dataDir>/provider_accounts.json', () => {
    expect(Storage.getProviderAccountsPath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'provider_accounts.json'),
    );
  });

  it('getGoogleAccountsPath returns <dataDir>/google_accounts.json', () => {
    expect(Storage.getGoogleAccountsPath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'google_accounts.json'),
    );
  });

  it('getOAuthCredsPath returns <dataDir>/oauth_creds.json', () => {
    expect(Storage.getOAuthCredsPath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'oauth_creds.json'),
    );
  });

  it('getGlobalMemoryFilePath returns <dataDir>/memory.md', () => {
    expect(Storage.getGlobalMemoryFilePath()).toBe(
      path.join(DATA_OVERRIDE_DIR, 'memory.md'),
    );
  });
});

describe('Storage – log/state-category methods resolve under log dir', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    process.env['LLXPRT_DATA_HOME'] = DATA_OVERRIDE_DIR;
    process.env['LLXPRT_CACHE_HOME'] = CACHE_OVERRIDE_DIR;
    process.env['LLXPRT_LOG_HOME'] = LOG_OVERRIDE_DIR;
  });

  afterEach(restoreEnv);

  it('getGlobalTempDir returns <logDir>/tmp (NOT under config dir)', () => {
    const result = Storage.getGlobalTempDir();
    expect(result).toBe(path.join(LOG_OVERRIDE_DIR, 'tmp'));
    // Confirm it is NOT resolving to the config dir.
    expect(result).not.toBe(path.join(OVERRIDE_DIR, 'tmp'));
    // Sanity: it should be a child of the log dir.
    expect(path.dirname(result)).toBe(LOG_OVERRIDE_DIR);
  });
});

describe('Storage – default platform paths (no overrides)', () => {
  beforeEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
    delete process.env['LLXPRT_DATA_HOME'];
    delete process.env['LLXPRT_CACHE_HOME'];
    delete process.env['LLXPRT_LOG_HOME'];
  });

  afterEach(restoreEnv);

  it('getGlobalConfigDir returns the platform config path without override', () => {
    const result = Storage.getGlobalConfigDir();
    // The app-name segment is always the basename; the parent identifies the
    // category (Preferences on macOS, Config on Windows, .config on Linux).
    expect(path.basename(result)).toBe('llxprt-code');
    const expectedParent = platformSegment('Preferences', 'Config', '.config');
    expect(result).toContain(expectedParent);
  });

  it('getGlobalDataDir returns the platform data path without override', () => {
    const result = Storage.getGlobalDataDir();
    const expectedBasename = platformSegment(
      'Application Support',
      'Data',
      'share',
    );
    expect(result).toContain(expectedBasename);
  });

  it('getGlobalCacheDir returns the platform cache path without override', () => {
    const result = Storage.getGlobalCacheDir();
    const expectedBasename = platformSegment('Caches', 'Cache', 'cache');
    expect(result).toContain(expectedBasename);
  });

  it('getGlobalLogDir returns the platform log/state path without override', () => {
    const result = Storage.getGlobalLogDir();
    const expectedBasename = platformSegment('Logs', 'Log', 'state');
    expect(result).toContain(expectedBasename);
  });

  it('getGlobalConfigDir falls through to platform path when override is empty', () => {
    process.env['LLXPRT_CONFIG_HOME'] = '';
    const result = Storage.getGlobalConfigDir();
    expect(path.basename(result)).toBe('llxprt-code');
  });
});

describe('Storage – legacy path', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = '/tmp/some-override';
  });

  afterEach(restoreEnv);

  it('getLegacyLlxprtDir returns ~/.llxprt regardless of override', () => {
    const expected = path.join(os.homedir(), '.llxprt');
    expect(Storage.getLegacyLlxprtDir()).toBe(expected);
  });
});

describe('Storage – instance (workspace-local) helpers', () => {
  const projectRoot = '/tmp/project';
  let storage: Storage;

  beforeEach(() => {
    // With only the config override set, all four category dirs collapse to
    // the same path, so getGlobalTempDir() / getHistoryDir() behave exactly
    // as the previous single-dir implementation did.
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    delete process.env['LLXPRT_DATA_HOME'];
    delete process.env['LLXPRT_CACHE_HOME'];
    delete process.env['LLXPRT_LOG_HOME'];
    storage = new Storage(projectRoot);
  });

  afterEach(restoreEnv);

  it('getWorkspaceSettingsPath returns project/.llxprt/settings.json', () => {
    const expected = path.join(projectRoot, '.llxprt', 'settings.json');
    expect(storage.getWorkspaceSettingsPath()).toBe(expected);
  });

  it('getProjectCommandsDir returns project/.llxprt/commands', () => {
    const expected = path.join(projectRoot, '.llxprt', 'commands');
    expect(storage.getProjectCommandsDir()).toBe(expected);
  });

  it('getProjectSkillsDir returns project/.llxprt/skills', () => {
    const expected = path.join(projectRoot, '.llxprt', 'skills');
    expect(storage.getProjectSkillsDir()).toBe(expected);
  });

  it('getExtensionsDir returns project/.llxprt/extensions', () => {
    const expected = path.join(projectRoot, '.llxprt', 'extensions');
    expect(storage.getExtensionsDir()).toBe(expected);
  });

  it('getExtensionsConfigPath returns project/.llxprt/extensions/llxprt-extension.json', () => {
    const expected = path.join(
      projectRoot,
      '.llxprt',
      'extensions',
      'llxprt-extension.json',
    );
    expect(storage.getExtensionsConfigPath()).toBe(expected);
  });

  it('getProjectTempDir is located directly under the global temp dir', () => {
    expect(path.dirname(storage.getProjectTempDir())).toBe(
      Storage.getGlobalTempDir(),
    );
  });

  it('getProjectTempDir is deterministic for a given project root', () => {
    const a = new Storage(projectRoot).getProjectTempDir();
    const b = new Storage(projectRoot).getProjectTempDir();
    expect(a).toBe(b);
  });

  it('getProjectTempDir is unique per project root', () => {
    const dirA = new Storage('/tmp/projectA').getProjectTempDir();
    const dirB = new Storage('/tmp/projectB').getProjectTempDir();
    expect(dirA).not.toBe(dirB);
  });

  it('getProjectTempDir directory-name segment is the sha256 of the project root (golden master / on-disk compatibility contract)', () => {
    // Golden master: sha256 hex of the raw, unnormalized string '/tmp/project'
    // (the exact projectRoot passed to the constructor; no path normalization).
    // Hard-coded (not recomputed) so this test fails if the temp-dir naming
    // scheme ever silently changes, which would orphan users' existing
    // on-disk project temp directories.
    const expectedSegment =
      'f630ad93b344dd6bd04d44ecde70b128e7e77f9ecc28ee90b62b018734a7e8c4';
    expect(path.basename(storage.getProjectTempDir())).toBe(expectedSegment);
  });

  it('getHistoryDir is located directly under the global history dir', () => {
    expect(path.dirname(storage.getHistoryDir())).toBe(
      path.join(Storage.getGlobalDataDir(), 'history'),
    );
  });

  it('getHistoryDir shares the same per-project segment as the temp dir', () => {
    expect(path.basename(storage.getHistoryDir())).toBe(
      path.basename(storage.getProjectTempDir()),
    );
  });

  it('getHistoryDir is deterministic for a given project root', () => {
    const a = new Storage(projectRoot).getHistoryDir();
    const b = new Storage(projectRoot).getHistoryDir();
    expect(a).toBe(b);
  });

  it('getHistoryDir is unique per project root', () => {
    const dirA = new Storage('/tmp/projectA').getHistoryDir();
    const dirB = new Storage('/tmp/projectB').getHistoryDir();
    expect(dirA).not.toBe(dirB);
  });

  it('getHistoryFilePath returns shell_history under the global temp dir', () => {
    const result = storage.getHistoryFilePath();
    expect(result).toBe(
      path.join(storage.getProjectTempDir(), 'shell_history'),
    );
    expect(result.startsWith(Storage.getGlobalTempDir())).toBe(true);
  });

  it('getProjectTempCheckpointsDir returns checkpoints under the global temp dir', () => {
    const result = storage.getProjectTempCheckpointsDir();
    expect(result).toBe(path.join(storage.getProjectTempDir(), 'checkpoints'));
    expect(result.startsWith(Storage.getGlobalTempDir())).toBe(true);
  });
});

describe('Storage – getSystemSettingsPath env override hardening', () => {
  const ENV_KEY = 'LLXPRT_SYSTEM_SETTINGS_PATH';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it('returns platform default when env override is unset', () => {
    expect(Storage.getSystemSettingsPath()).toBe(
      expectedDefaultSystemSettingsPath(),
    );
  });

  it('normalizes an absolute override via path.resolve', () => {
    const raw = `${os.tmpdir()}/llxprt-system/../settings.json`;
    process.env[ENV_KEY] = raw;
    expect(Storage.getSystemSettingsPath()).toBe(path.resolve(raw));
  });

  it('collapses traversal segments in an absolute override', () => {
    const base = os.tmpdir();
    const raw = `${base}/a/../b/settings.json`;
    process.env[ENV_KEY] = raw;
    expect(Storage.getSystemSettingsPath()).toBe(
      path.resolve(`${base}/b/settings.json`),
    );
  });

  it('ignores a relative override in favor of platform default', () => {
    process.env[ENV_KEY] = '../settings.json';
    expect(Storage.getSystemSettingsPath()).toBe(
      expectedDefaultSystemSettingsPath(),
    );
  });

  it('ignores a nested-relative override in favor of platform default', () => {
    process.env[ENV_KEY] = 'relative/settings.json';
    expect(Storage.getSystemSettingsPath()).toBe(
      expectedDefaultSystemSettingsPath(),
    );
  });

  it('ignores a whitespace-only override in favor of platform default', () => {
    process.env[ENV_KEY] = '   ';
    expect(Storage.getSystemSettingsPath()).toBe(
      expectedDefaultSystemSettingsPath(),
    );
  });

  it('ignores an empty-string override in favor of platform default', () => {
    process.env[ENV_KEY] = '';
    expect(Storage.getSystemSettingsPath()).toBe(
      expectedDefaultSystemSettingsPath(),
    );
  });

  it('rejects raw env input: resolved path differs from raw when traversal present', () => {
    const raw = `${os.tmpdir()}/x/../settings.json`;
    process.env[ENV_KEY] = raw;
    const result = Storage.getSystemSettingsPath();
    expect(result).not.toBe(raw);
    expect(result).toBe(path.resolve(raw));
  });

  it('trims leading whitespace on an absolute override and resolves it', () => {
    const cleaned = `${os.tmpdir()}/settings.json`;
    process.env[ENV_KEY] = `   ${cleaned}`;
    expect(Storage.getSystemSettingsPath()).toBe(path.resolve(cleaned));
  });

  it('trims trailing whitespace on an absolute override and resolves it', () => {
    const cleaned = `${os.tmpdir()}/settings.json`;
    process.env[ENV_KEY] = `${cleaned}   `;
    expect(Storage.getSystemSettingsPath()).toBe(path.resolve(cleaned));
  });

  it('trims surrounding whitespace on an absolute override and resolves it', () => {
    const cleaned = `${os.tmpdir()}/settings.json`;
    process.env[ENV_KEY] = ` \t ${cleaned} \n`;
    expect(Storage.getSystemSettingsPath()).toBe(path.resolve(cleaned));
  });

  it('does not preserve trailing whitespace in the resolved path', () => {
    const cleaned = `${os.tmpdir()}/settings.json`;
    const raw = `${cleaned}   `;
    process.env[ENV_KEY] = raw;
    const result = Storage.getSystemSettingsPath();
    expect(result).toBe(path.resolve(cleaned));
    expect(result).not.toBe(path.resolve(raw));
  });
});

describe('Storage – getSystemPoliciesDir derives from sanitized path', () => {
  const ENV_KEY = 'LLXPRT_SYSTEM_SETTINGS_PATH';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it('derives policies dir from resolved settings path, not raw env input', () => {
    const raw = `${os.tmpdir()}/llxprt-system/sub/../sub2/../../settings.json`;
    process.env[ENV_KEY] = raw;
    const resolved = path.resolve(raw);
    expect(Storage.getSystemPoliciesDir()).toBe(
      path.join(path.dirname(resolved), 'policies'),
    );
  });

  it('derives policies dir from platform default when override is relative', () => {
    process.env[ENV_KEY] = 'relative/settings.json';
    expect(Storage.getSystemPoliciesDir()).toBe(
      path.join(path.dirname(expectedDefaultSystemSettingsPath()), 'policies'),
    );
  });
});
