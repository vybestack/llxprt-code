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
// Global paths are tested via the LLXPRT_CONFIG_HOME override so results are
// deterministic regardless of the host platform. The override dir is set in
// beforeEach and cleaned up in afterEach.
// ---------------------------------------------------------------------------

const OVERRIDE_DIR = '/tmp/llxprt-test-config-home';

describe('Storage – global path resolution', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
  });

  afterEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
  });

  it('getGlobalLlxprtDir respects LLXPRT_CONFIG_HOME override', () => {
    expect(Storage.getGlobalLlxprtDir()).toBe(OVERRIDE_DIR);
  });

  it('getGlobalSettingsPath returns <override>/settings.json', () => {
    const expected = path.join(OVERRIDE_DIR, 'settings.json');
    expect(Storage.getGlobalSettingsPath()).toBe(expected);
  });

  it('getUserCommandsDir returns <override>/commands', () => {
    const expected = path.join(OVERRIDE_DIR, 'commands');
    expect(Storage.getUserCommandsDir()).toBe(expected);
  });

  it('getMcpOAuthTokensPath returns <override>/mcp-oauth-tokens.json', () => {
    const expected = path.join(OVERRIDE_DIR, 'mcp-oauth-tokens.json');
    expect(Storage.getMcpOAuthTokensPath()).toBe(expected);
  });

  it('getGlobalMemoryFilePath returns <override>/memory.md', () => {
    const expected = path.join(OVERRIDE_DIR, 'memory.md');
    expect(Storage.getGlobalMemoryFilePath()).toBe(expected);
  });

  it('getInstallationIdPath returns <override>/installation_id', () => {
    const expected = path.join(OVERRIDE_DIR, 'installation_id');
    expect(Storage.getInstallationIdPath()).toBe(expected);
  });

  it('getProviderAccountsPath returns <override>/provider_accounts.json', () => {
    const expected = path.join(OVERRIDE_DIR, 'provider_accounts.json');
    expect(Storage.getProviderAccountsPath()).toBe(expected);
  });

  it('getOAuthCredsPath returns <override>/oauth_creds.json', () => {
    const expected = path.join(OVERRIDE_DIR, 'oauth_creds.json');
    expect(Storage.getOAuthCredsPath()).toBe(expected);
  });

  it('getGlobalTempDir returns <override>/tmp', () => {
    const expected = path.join(OVERRIDE_DIR, 'tmp');
    expect(Storage.getGlobalTempDir()).toBe(expected);
  });

  it('getMachineSecretPath returns <override>/machine_secret', () => {
    const expected = path.join(OVERRIDE_DIR, 'machine_secret');
    expect(Storage.getMachineSecretPath()).toBe(expected);
  });
});

describe('Storage – default platform path (no override)', () => {
  beforeEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
  });

  afterEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
  });

  it('getGlobalLlxprtDir returns a "configuration" suffix without override', () => {
    const result = Storage.getGlobalLlxprtDir();
    expect(result.endsWith(path.join('llxprt-code', 'configuration'))).toBe(
      true,
    );
  });
});

describe('Storage – legacy path', () => {
  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = '/tmp/some-override';
  });

  afterEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
  });

  it('getLegacyLlxprtDir returns ~/.llxprt', () => {
    const expected = path.join(os.homedir(), '.llxprt');
    expect(Storage.getLegacyLlxprtDir()).toBe(expected);
  });

  it('getLegacyLlxprtDir is unaffected by LLXPRT_CONFIG_HOME', () => {
    const expected = path.join(os.homedir(), '.llxprt');
    expect(Storage.getLegacyLlxprtDir()).toBe(expected);
  });
});

describe('Storage – instance (workspace-local) helpers', () => {
  const projectRoot = '/tmp/project';
  let storage: Storage;

  beforeEach(() => {
    process.env['LLXPRT_CONFIG_HOME'] = OVERRIDE_DIR;
    storage = new Storage(projectRoot);
  });

  afterEach(() => {
    delete process.env['LLXPRT_CONFIG_HOME'];
  });

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

  it('getProjectTempDir returns hashed temp dir under global dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(OVERRIDE_DIR, 'tmp', hash);
    expect(storage.getProjectTempDir()).toBe(expected);
  });

  it('getHistoryDir returns hashed history dir under global dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(OVERRIDE_DIR, 'history', hash);
    expect(storage.getHistoryDir()).toBe(expected);
  });

  it('getHistoryFilePath returns shell_history in project temp dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(OVERRIDE_DIR, 'tmp', hash, 'shell_history');
    expect(storage.getHistoryFilePath()).toBe(expected);
  });

  it('getProjectTempCheckpointsDir returns checkpoints in project temp dir', () => {
    const hash = (
      storage as unknown as { getFilePathHash: (p: string) => string }
    ).getFilePathHash(projectRoot);
    const expected = path.join(OVERRIDE_DIR, 'tmp', hash, 'checkpoints');
    expect(storage.getProjectTempCheckpointsDir()).toBe(expected);
  });
});
