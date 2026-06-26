/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      path.join(Storage.getGlobalLlxprtDir(), 'history'),
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
