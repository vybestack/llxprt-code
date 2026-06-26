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

// ---------------------------------------------------------------------------
// Storage method behavioral tests
// Constructor is deferred into beforeEach / inside individual tests so that
// the "not implemented" throw does not crash the entire suite at module
// evaluation time.
// ---------------------------------------------------------------------------

describe('Storage – getGlobalSettingsPath', () => {
  it('returns path to ~/.llxprt/settings.json', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'settings.json');
    expect(Storage.getGlobalSettingsPath()).toBe(expected);
  });
});

describe('Storage – additional helpers', () => {
  const projectRoot = '/tmp/project';
  let storage: Storage;

  beforeEach(() => {
    storage = new Storage(projectRoot);
  });

  it('getWorkspaceSettingsPath returns project/.llxprt/settings.json', () => {
    const expected = path.join(projectRoot, '.llxprt', 'settings.json');
    expect(storage.getWorkspaceSettingsPath()).toBe(expected);
  });

  it('getUserCommandsDir returns ~/.llxprt/commands', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'commands');
    expect(Storage.getUserCommandsDir()).toBe(expected);
  });

  it('getProjectCommandsDir returns project/.llxprt/commands', () => {
    const expected = path.join(projectRoot, '.llxprt', 'commands');
    expect(storage.getProjectCommandsDir()).toBe(expected);
  });

  it('getProjectSkillsDir returns project/.llxprt/skills', () => {
    const expected = path.join(projectRoot, '.llxprt', 'skills');
    expect(storage.getProjectSkillsDir()).toBe(expected);
  });

  it('getMcpOAuthTokensPath returns ~/.llxprt/mcp-oauth-tokens.json', () => {
    const expected = path.join(
      os.homedir(),
      '.llxprt',
      'mcp-oauth-tokens.json',
    );
    expect(Storage.getMcpOAuthTokensPath()).toBe(expected);
  });

  it('getGlobalMemoryFilePath returns ~/.llxprt/memory.md', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'memory.md');
    expect(Storage.getGlobalMemoryFilePath()).toBe(expected);
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

  it('getProjectTempDir returns hashed temp dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(os.homedir(), '.llxprt', 'tmp', hash);
    expect(storage.getProjectTempDir()).toBe(expected);
  });

  it('getHistoryDir returns hashed history dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(os.homedir(), '.llxprt', 'history', hash);
    expect(storage.getHistoryDir()).toBe(expected);
  });

  it('getHistoryFilePath returns shell_history in project temp dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(
      os.homedir(),
      '.llxprt',
      'tmp',
      hash,
      'shell_history',
    );
    expect(storage.getHistoryFilePath()).toBe(expected);
  });

  it('getProjectTempCheckpointsDir returns checkpoints in project temp dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(
      os.homedir(),
      '.llxprt',
      'tmp',
      hash,
      'checkpoints',
    );
    expect(storage.getProjectTempCheckpointsDir()).toBe(expected);
  });

  it('getInstallationIdPath returns ~/.llxprt/installation_id', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'installation_id');
    expect(Storage.getInstallationIdPath()).toBe(expected);
  });

  it('getProviderAccountsPath returns ~/.llxprt/provider_accounts.json', () => {
    const expected = path.join(
      os.homedir(),
      '.llxprt',
      'provider_accounts.json',
    );
    expect(Storage.getProviderAccountsPath()).toBe(expected);
  });

  it('getOAuthCredsPath returns ~/.llxprt/oauth_creds.json', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'oauth_creds.json');
    expect(Storage.getOAuthCredsPath()).toBe(expected);
  });

  it('getGlobalTempDir returns ~/.llxprt/tmp', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'tmp');
    expect(Storage.getGlobalTempDir()).toBe(expected);
  });

  it('getMachineSecretPath returns ~/.llxprt/machine_secret', () => {
    const expected = path.join(os.homedir(), '.llxprt', 'machine_secret');
    expect(Storage.getMachineSecretPath()).toBe(expected);
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
