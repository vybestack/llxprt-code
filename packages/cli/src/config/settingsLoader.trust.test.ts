/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import * as osActual from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { loadSettings, USER_SETTINGS_PATH } from './settings.js';
import { resetTrustedFoldersForTesting, TrustLevel } from './trustedFolders.js';

vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof osActual>();
  return {
    ...actualOs,
    homedir: vi.fn(() => '/mock/home/user'),
    platform: vi.fn(() => 'linux'),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof fs>();
  return {
    ...actualFs,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: vi.fn((location: fs.PathLike): string => String(location)),
  };
});

const realFs = await vi.importActual<typeof import('fs')>('fs');
const realOs = await vi.importActual<typeof import('os')>('os');

const mockCoreEvents = vi.hoisted(() => ({
  emitFeedback: vi.fn(),
  emitSettingsChanged: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    coreEvents: mockCoreEvents,
    getIdeTrust: () => undefined,
  };
});

const TRUSTED_FOLDERS_PATH = '/mock/home/user/trustedFolders.json';
const temporaryDirectories: string[] = [];

describe('settingsLoader workspace trust provenance', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (vi.mocked(fs.realpathSync) as Mock).mockImplementation(
      (location: fs.PathLike): string => String(location),
    );
    resetTrustedFoldersForTesting();
    process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH = '/mock/system/settings.json';
    process.env.LLXPRT_CODE_SYSTEM_DEFAULTS_PATH =
      '/mock/system/system-defaults.json';
    process.env.LLXPRT_CODE_TRUSTED_FOLDERS_PATH = TRUSTED_FOLDERS_PATH;
    vi.mocked(osActual.homedir).mockReturnValue('/mock/home/user');
  });

  afterEach(() => {
    resetTrustedFoldersForTesting();
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      realFs.rmSync(directory, { recursive: true, force: true });
    }
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.LLXPRT_CODE_SYSTEM_DEFAULTS_PATH;
    delete process.env.LLXPRT_CODE_TRUSTED_FOLDERS_PATH;
  });

  function exposeTrustRules(rules: Record<string, TrustLevel>): void {
    (vi.mocked(fs.existsSync) as Mock).mockImplementation(
      (path: fs.PathLike) =>
        path === USER_SETTINGS_PATH || path === TRUSTED_FOLDERS_PATH,
    );
    (vi.mocked(fs.readFileSync) as Mock).mockImplementation(
      (path: fs.PathOrFileDescriptor) => {
        if (path === USER_SETTINGS_PATH) {
          return JSON.stringify({
            folderTrustFeature: true,
            folderTrust: true,
          });
        }
        if (path === TRUSTED_FOLDERS_PATH) {
          return JSON.stringify(rules);
        }
        return '{}';
      },
    );
  }

  it('uses the explicit workspace path instead of a denied process cwd', () => {
    exposeTrustRules({
      '/trusted/workspace': TrustLevel.TRUST_FOLDER,
      '/untrusted/cwd': TrustLevel.DO_NOT_TRUST,
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/untrusted/cwd');

    const settings = loadSettings('/trusted/workspace');

    expect(settings.isTrusted).toBe(true);
  });

  it('does not inherit trust from process cwd for a denied explicit workspace', () => {
    exposeTrustRules({
      '/trusted/cwd': TrustLevel.TRUST_FOLDER,
      '/untrusted/workspace': TrustLevel.DO_NOT_TRUST,
    });
    vi.spyOn(process, 'cwd').mockReturnValue('/trusted/cwd');

    const settings = loadSettings('/untrusted/workspace');

    expect(settings.isTrusted).toBe(false);
  });

  it('uses a canonical denial instead of opposing trust on a workspace symlink', () => {
    const temporaryDirectory = realFs.mkdtempSync(
      path.join(realOs.tmpdir(), 'llxprt-settings-trust-'),
    );
    temporaryDirectories.push(temporaryDirectory);
    const targetDirectory = path.join(temporaryDirectory, 'target');
    const workspaceSymlink = path.join(temporaryDirectory, 'workspace-link');
    realFs.mkdirSync(targetDirectory);
    realFs.symlinkSync(targetDirectory, workspaceSymlink, 'dir');
    const canonicalTarget = realFs.realpathSync(targetDirectory);
    exposeTrustRules({
      [canonicalTarget]: TrustLevel.DO_NOT_TRUST,
      [workspaceSymlink]: TrustLevel.TRUST_FOLDER,
    });
    (vi.mocked(fs.realpathSync) as Mock).mockImplementation(
      (location: fs.PathLike): string =>
        String(location) === '/mock/home/user'
          ? String(location)
          : realFs.realpathSync(location),
    );

    const settings = loadSettings(workspaceSymlink);

    expect(settings.isTrusted).toBe(false);
  });

  it('fails closed when no trust rule matches the workspace', () => {
    exposeTrustRules({
      '/some/other/path': TrustLevel.TRUST_FOLDER,
    });

    const settings = loadSettings('/unmatched/workspace');

    expect(settings.isTrusted).toBe(false);
  });

  it('fails closed when the workspace canonical identity cannot be resolved', () => {
    const workspace = '/trusted/workspace';
    exposeTrustRules({ [workspace]: TrustLevel.TRUST_FOLDER });
    (vi.mocked(fs.realpathSync) as Mock).mockImplementation(
      (location: fs.PathLike): string => {
        if (String(location) === path.resolve(workspace)) {
          throw new Error('canonical identity unavailable');
        }
        return String(location);
      },
    );

    const settings = loadSettings(workspace);

    expect(settings.isTrusted).toBe(false);
  });
});
