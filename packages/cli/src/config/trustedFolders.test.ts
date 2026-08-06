/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Mock 'os' first.
import * as osActual from 'os';
const actualOs = { ...(await import('os')) };
vi.mock('os', () => {
  return {
    ...actualOs,
    homedir: vi.fn(() => '/mock/home/user'),
    platform: vi.fn(() => 'linux'),
  };
});

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actual,
    getIdeTrust: vi.fn(),
  };
});

import { FatalConfigError, getIdeTrust } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import * as fs from 'fs';
import stripJsonComments from 'strip-json-comments';
import * as path from 'path';

import {
  loadTrustedFolders,
  getTrustedFoldersPath,
  TrustLevel,
  isWorkspaceTrusted,
  resetTrustedFoldersForTesting,
} from './trustedFolders.js';
import type { Settings } from './settings.js';

const CANONICAL_NEW_PATH = path.resolve('/new/path');

function createErrorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const TRUSTED_FOLDERS_FILE_MODE = 0o600;

const actualFs = { ...(await import('fs')) };
vi.mock('fs', () => {
  return {
    ...actualFs,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    chmodSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: vi.fn((location: fs.PathLike) => location),
  };
});

vi.mock('strip-json-comments', () => ({
  default: vi.fn((content) => content),
}));

describe('Trusted Folders Loading', () => {
  let mockFsExistsSync: Mock<typeof fs.existsSync>;
  let mockStripJsonComments: Mock<typeof stripJsonComments>;
  let mockFsWriteFileSync: Mock<typeof fs.writeFileSync>;
  let mockFsChmodSync: Mock<typeof fs.chmodSync>;
  let mockFsStatSync: Mock<typeof fs.statSync>;
  let mockFsRenameSync: Mock<typeof fs.renameSync>;
  let mockFsUnlinkSync: Mock<typeof fs.unlinkSync>;

  beforeEach(() => {
    resetTrustedFoldersForTesting();
    vi.resetAllMocks();
    mockFsExistsSync = fs.existsSync as Mock<typeof fs.existsSync>;
    mockStripJsonComments = stripJsonComments as Mock<typeof stripJsonComments>;
    mockFsWriteFileSync = fs.writeFileSync as Mock<typeof fs.writeFileSync>;
    mockFsChmodSync = fs.chmodSync as Mock<typeof fs.chmodSync>;
    mockFsStatSync = fs.statSync as Mock<typeof fs.statSync>;
    mockFsRenameSync = fs.renameSync as Mock<typeof fs.renameSync>;
    mockFsUnlinkSync = fs.unlinkSync as Mock<typeof fs.unlinkSync>;
    mockFsStatSync.mockReturnValue({
      mode: TRUSTED_FOLDERS_FILE_MODE,
    } as fs.Stats);
    (osActual.homedir as Mock<typeof osActual.homedir>).mockReturnValue(
      '/mock/home/user',
    );
    (
      mockStripJsonComments as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation((jsonString: string) => jsonString);
    (mockFsExistsSync as Mock<(...args: never[]) => unknown>).mockReturnValue(
      false,
    );
    (fs.readFileSync as Mock<(...args: never[]) => unknown>).mockReturnValue(
      '{}',
    );
    (fs.realpathSync as Mock<typeof fs.realpathSync>).mockImplementation(
      (location) =>
        typeof location === 'string' ? location : location.toString(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load empty rules if no files exist', () => {
    const { rules, errors } = loadTrustedFolders();
    expect(rules).toStrictEqual([]);
    expect(errors).toStrictEqual([]);
  });

  describe('isPathTrusted', () => {
    function setup({ config = {} as Record<string, TrustLevel> } = {}) {
      (
        mockFsExistsSync as Mock<(...args: never[]) => unknown>
      ).mockImplementation((p) => p === getTrustedFoldersPath());
      (
        fs.readFileSync as Mock<(...args: never[]) => unknown>
      ).mockImplementation((p) => {
        if (p === getTrustedFoldersPath()) return JSON.stringify(config);
        return '{}';
      });

      const folders = loadTrustedFolders();

      return { folders };
    }

    it('provides a method to determine if a path is trusted', () => {
      const { folders } = setup({
        config: {
          './myfolder': TrustLevel.TRUST_FOLDER,
          '/trustedparent/trustme': TrustLevel.TRUST_PARENT,
          '/user/folder': TrustLevel.TRUST_FOLDER,
          '/secret': TrustLevel.DO_NOT_TRUST,
          '/secret/publickeys': TrustLevel.TRUST_FOLDER,
        },
      });
      expect(folders.isPathTrusted('/secret')).toBe(false);
      expect(folders.isPathTrusted('/user/folder')).toBe(true);
      expect(folders.isPathTrusted('/secret/publickeys/public.pem')).toBe(true);
      expect(folders.isPathTrusted('/user/folder/harhar')).toBe(true);
      expect(folders.isPathTrusted('myfolder/somefile.jpg')).toBe(true);
      expect(folders.isPathTrusted('/trustedparent/someotherfolder')).toBe(
        true,
      );
      expect(folders.isPathTrusted('/trustedparent/trustme')).toBe(true);

      expect(folders.isPathTrusted('/secret/bankaccounts.json')).toBe(false);
      expect(folders.isPathTrusted('/secret/mine/privatekey.pem')).toBe(false);
      expect(folders.isPathTrusted('/user/someotherfolder')).toBe(undefined);
    });

    it('uses the most specific matching rule when trust rules compete', () => {
      const { folders } = setup({
        config: {
          '/workspace': TrustLevel.TRUST_FOLDER,
          '/workspace/private': TrustLevel.DO_NOT_TRUST,
          '/workspace/private/public': TrustLevel.TRUST_FOLDER,
        },
      });

      expect(folders.isPathTrusted('/workspace/private')).toBe(false);
      expect(folders.isPathTrusted('/workspace/private/public/file')).toBe(
        true,
      );
    });

    it('prefers denial when direct and TRUST_PARENT rules have equal specificity', () => {
      const { folders } = setup({
        config: {
          '/workspace/trust-parent-source': TrustLevel.TRUST_PARENT,
          '/workspace': TrustLevel.DO_NOT_TRUST,
        },
      });

      expect(folders.isPathTrusted('/workspace/project')).toBe(false);
    });

    it('does not treat a sibling string prefix as an ancestor', () => {
      const { folders } = setup({
        config: { '/workspace/app': TrustLevel.TRUST_FOLDER },
      });

      expect(folders.isPathTrusted('/workspace/application')).toBe(undefined);
    });

    it('fails closed when a matching denial rule cannot be canonicalized', () => {
      const { folders } = setup({
        config: { '/secret': TrustLevel.DO_NOT_TRUST },
      });
      (fs.realpathSync as Mock<typeof fs.realpathSync>).mockImplementation(
        (location) => {
          const resolved = location.toString();
          if (resolved === '/secret') {
            throw new Error('permission denied');
          }
          return resolved;
        },
      );

      expect(folders.isPathTrusted('/secret/file')).toBe(false);
    });
  });

  it('should load user rules if only user file exists', () => {
    const userPath = getTrustedFoldersPath();
    (
      mockFsExistsSync as Mock<(...args: never[]) => unknown>
    ).mockImplementation((p) => p === userPath);
    const userContent = {
      '/user/folder': TrustLevel.TRUST_FOLDER,
    };
    (fs.readFileSync as Mock<(...args: never[]) => unknown>).mockImplementation(
      (p) => {
        if (p === userPath) return JSON.stringify(userContent);
        return '{}';
      },
    );

    const { rules, errors } = loadTrustedFolders();
    expect(rules).toStrictEqual([
      { path: '/user/folder', trustLevel: TrustLevel.TRUST_FOLDER },
    ]);
    expect(errors).toStrictEqual([]);
  });

  it('should handle JSON parsing errors gracefully', () => {
    const userPath = getTrustedFoldersPath();
    (
      mockFsExistsSync as Mock<(...args: never[]) => unknown>
    ).mockImplementation((p) => p === userPath);
    (fs.readFileSync as Mock<(...args: never[]) => unknown>).mockImplementation(
      (p) => {
        if (p === userPath) return 'invalid json';
        return '{}';
      },
    );

    const { rules, errors } = loadTrustedFolders();
    expect(rules).toStrictEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe(userPath);
    // V8 reports "Unexpected token ..." and JavaScriptCore reports
    // "Unexpected identifier ..."; both describe the same parse failure.
    expect(errors[0].message).toMatch(/Unexpected (token|identifier)/);
  });

  it('should use LLXPRT_CODE_TRUSTED_FOLDERS_PATH env var if set', () => {
    const customPath = '/custom/path/to/trusted_folders.json';
    process.env['LLXPRT_CODE_TRUSTED_FOLDERS_PATH'] = customPath;

    (
      mockFsExistsSync as Mock<(...args: never[]) => unknown>
    ).mockImplementation((p) => p === customPath);
    const userContent = {
      '/user/folder/from/env': TrustLevel.TRUST_FOLDER,
    };
    (fs.readFileSync as Mock<(...args: never[]) => unknown>).mockImplementation(
      (p) => {
        if (p === customPath) return JSON.stringify(userContent);
        return '{}';
      },
    );

    const { rules, errors } = loadTrustedFolders();
    expect(rules).toStrictEqual([
      {
        path: '/user/folder/from/env',
        trustLevel: TrustLevel.TRUST_FOLDER,
      },
    ]);
    expect(errors).toStrictEqual([]);

    delete process.env['LLXPRT_CODE_TRUSTED_FOLDERS_PATH'];
  });

  it('setValue should update the user config and save it', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER);

    expect(loadedFolders.user.config[CANONICAL_NEW_PATH]).toBe(
      TrustLevel.TRUST_FOLDER,
    );
    expect(mockFsWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.trustedFolders.json.'),
      JSON.stringify(
        { [CANONICAL_NEW_PATH]: TrustLevel.TRUST_FOLDER },
        null,
        2,
      ),
      { encoding: 'utf-8', mode: TRUSTED_FOLDERS_FILE_MODE, flag: 'wx' },
    );
    const temporaryPath = (fs.writeFileSync as Mock<typeof fs.writeFileSync>)
      .mock.calls[0][0];
    expect(mockFsChmodSync).toHaveBeenCalledWith(
      temporaryPath,
      TRUSTED_FOLDERS_FILE_MODE,
    );
    expect(mockFsStatSync).toHaveBeenCalledWith(temporaryPath);
    expect(mockFsRenameSync).toHaveBeenCalledWith(
      temporaryPath,
      getTrustedFoldersPath(),
    );
    expect(
      (fs.writeFileSync as Mock<typeof fs.writeFileSync>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(mockFsChmodSync.mock.invocationCallOrder[0]);
    expect(
      (fs.writeFileSync as Mock<typeof fs.writeFileSync>).mock
        .invocationCallOrder[0],
    ).toBeLessThan(mockFsStatSync.mock.invocationCallOrder[0]);
    expect(mockFsChmodSync.mock.invocationCallOrder[0]).toBeLessThan(
      mockFsRenameSync.mock.invocationCallOrder[0],
    );
    expect(mockFsStatSync.mock.invocationCallOrder[0]).toBeLessThan(
      mockFsRenameSync.mock.invocationCallOrder[0],
    );
  });

  it('deleteValue should remove an existing rule and save it', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    loadedFolders.user.config['/existing/path'] = TrustLevel.TRUST_FOLDER;

    loadedFolders.deleteValue('/existing/path');

    expect(loadedFolders.user.config['/existing/path']).toBeUndefined();
    expect(mockFsWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.trustedFolders.json.'),
      JSON.stringify({}, null, 2),
      { encoding: 'utf-8', mode: TRUSTED_FOLDERS_FILE_MODE, flag: 'wx' },
    );
    expect(mockFsRenameSync).toHaveBeenCalledOnce();
  });

  it('deleteValue restores the in-memory rule when saving fails', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    loadedFolders.user.config['/existing/path'] = TrustLevel.DO_NOT_TRUST;
    mockFsRenameSync.mockImplementationOnce(() => {
      throw new Error('rename denied');
    });

    expect(() => loadedFolders.deleteValue('/existing/path')).toThrow(
      'rename denied',
    );

    expect(loadedFolders.user.config['/existing/path']).toBe(
      TrustLevel.DO_NOT_TRUST,
    );
  });

  it('keeps the destination and in-memory rule unchanged when temp chmod fails', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    loadedFolders.user.config['/existing/path'] = TrustLevel.DO_NOT_TRUST;
    mockFsChmodSync.mockImplementationOnce(() => {
      throw new Error('chmod denied');
    });

    expect(() =>
      loadedFolders.setValue('/existing/path', TrustLevel.TRUST_FOLDER),
    ).toThrow('chmod denied');

    expect(mockFsRenameSync).not.toHaveBeenCalled();
    expect(loadedFolders.user.config['/existing/path']).toBe(
      TrustLevel.DO_NOT_TRUST,
    );
  });

  it('commits the file when chmod reports that POSIX modes are unsupported', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    const unsupportedError = createErrorWithCode(
      'chmod unsupported',
      'ENOTSUP',
    );
    const warnSpy = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    mockFsChmodSync.mockImplementationOnce(() => {
      throw unsupportedError;
    });

    loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER);

    expect(mockFsRenameSync).toHaveBeenCalledOnce();
    expect(loadedFolders.user.config[CANONICAL_NEW_PATH]).toBe(
      TrustLevel.TRUST_FOLDER,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not support POSIX file modes'),
      unsupportedError,
    );
  });

  it('commits the file when stat reports that POSIX modes are unsupported', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    const unsupportedError = createErrorWithCode('stat unsupported', 'ENOSYS');
    const warnSpy = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    mockFsStatSync.mockImplementationOnce(() => {
      throw unsupportedError;
    });

    loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER);

    expect(mockFsRenameSync).toHaveBeenCalledOnce();
    expect(loadedFolders.user.config[CANONICAL_NEW_PATH]).toBe(
      TrustLevel.TRUST_FOLDER,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not support POSIX file modes'),
      unsupportedError,
    );
  });

  it('preserves in-memory state when writing the temporary file fails', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    mockFsWriteFileSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(() =>
      loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER),
    ).toThrow('disk full');

    expect(loadedFolders.user.config[CANONICAL_NEW_PATH]).toBeUndefined();
    expect(mockFsRenameSync).not.toHaveBeenCalled();
  });

  it('removes the temporary file when the atomic rename fails', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();
    mockFsRenameSync.mockImplementationOnce(() => {
      throw new Error('rename denied');
    });

    expect(() =>
      loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER),
    ).toThrow('rename denied');

    const temporaryPath = (fs.writeFileSync as Mock<typeof fs.writeFileSync>)
      .mock.calls[0][0];
    expect(mockFsUnlinkSync).toHaveBeenCalledWith(temporaryPath);
    expect(loadedFolders.user.config[CANONICAL_NEW_PATH]).toBeUndefined();
  });

  it('warns when a failed atomic rename cannot remove its temporary file', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const cleanupError = new Error('unlink denied');
    const warnSpy = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    const loadedFolders = loadTrustedFolders();
    mockFsRenameSync.mockImplementationOnce(() => {
      throw new Error('rename denied');
    });
    mockFsUnlinkSync.mockImplementationOnce(() => {
      throw cleanupError;
    });

    expect(() =>
      loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER),
    ).toThrow('rename denied');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to remove trusted folders temporary file',
      ),
      cleanupError,
    );
  });

  it('atomically saves on Windows without POSIX mode operations', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const loadedFolders = loadTrustedFolders();

    loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER);

    const temporaryPath = (fs.writeFileSync as Mock<typeof fs.writeFileSync>)
      .mock.calls[0][0];
    expect(mockFsChmodSync).not.toHaveBeenCalled();
    expect(mockFsStatSync).not.toHaveBeenCalled();
    expect(mockFsRenameSync).toHaveBeenCalledWith(
      temporaryPath,
      getTrustedFoldersPath(),
    );
  });

  it('performs no fallible cleanup after the atomic rename commit point', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const loadedFolders = loadTrustedFolders();

    loadedFolders.setValue(CANONICAL_NEW_PATH, TrustLevel.TRUST_FOLDER);

    expect(mockFsWriteFileSync).toHaveBeenCalledOnce();
    expect(mockFsChmodSync).toHaveBeenCalledOnce();
    expect(mockFsStatSync).toHaveBeenCalledOnce();
    expect(mockFsRenameSync).toHaveBeenCalledOnce();
    expect(mockFsUnlinkSync).not.toHaveBeenCalled();
    const renameOrder = mockFsRenameSync.mock.invocationCallOrder[0];
    expect(mockFsWriteFileSync.mock.invocationCallOrder[0]).toBeLessThan(
      renameOrder,
    );
    expect(mockFsChmodSync.mock.invocationCallOrder[0]).toBeLessThan(
      renameOrder,
    );
    expect(mockFsStatSync.mock.invocationCallOrder[0]).toBeLessThan(
      renameOrder,
    );
  });
});

describe('isWorkspaceTrusted', () => {
  let mockCwd: string;
  const mockRules: Record<string, TrustLevel> = {};
  const mockSettings: Settings = {
    folderTrust: true,
  } as Settings;

  beforeEach(() => {
    resetTrustedFoldersForTesting();
    vi.spyOn(process, 'cwd').mockImplementation(() => mockCwd);
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === getTrustedFoldersPath()) {
        return JSON.stringify(mockRules);
      }
      return '{}';
    });
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => p === getTrustedFoldersPath(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear the object
    Object.keys(mockRules).forEach((key) => delete mockRules[key]);
  });

  it('should throw a fatal error if the config is malformed', () => {
    mockCwd = '/home/user/projectA';
    // This mock needs to be specific to this test to override the one in beforeEach
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === getTrustedFoldersPath()) {
        return '{"foo": "bar",}'; // Malformed JSON with trailing comma
      }
      return '{}';
    });
    expect(() => isWorkspaceTrusted(mockSettings)).toThrow(FatalConfigError);
    expect(() => isWorkspaceTrusted(mockSettings)).toThrow(
      /Please fix the configuration file/,
    );
  });

  it('should throw a fatal error if the config is not a JSON object', () => {
    mockCwd = '/home/user/projectA';
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === getTrustedFoldersPath()) {
        return 'null';
      }
      return '{}';
    });
    expect(() => isWorkspaceTrusted(mockSettings)).toThrow(FatalConfigError);
    expect(() => isWorkspaceTrusted(mockSettings)).toThrow(
      /not a valid JSON object/,
    );
  });

  it('should return true for a directly trusted folder', () => {
    mockCwd = '/home/user/projectA';
    mockRules['/home/user/projectA'] = TrustLevel.TRUST_FOLDER;
    expect(isWorkspaceTrusted(mockSettings)).toBe(true);
  });

  it('should return true for a child of a trusted folder', () => {
    mockCwd = '/home/user/projectA/src';
    mockRules['/home/user/projectA'] = TrustLevel.TRUST_FOLDER;
    expect(isWorkspaceTrusted(mockSettings)).toBe(true);
  });

  it('should return true for a child of a trusted parent folder', () => {
    mockCwd = '/home/user/projectB';
    mockRules['/home/user/projectB/somefile.txt'] = TrustLevel.TRUST_PARENT;
    expect(isWorkspaceTrusted(mockSettings)).toBe(true);
  });

  it('should return false for a directly untrusted folder', () => {
    mockCwd = '/home/user/untrusted';
    mockRules['/home/user/untrusted'] = TrustLevel.DO_NOT_TRUST;
    expect(isWorkspaceTrusted(mockSettings)).toBe(false);
  });

  it('should return false for a child of an untrusted folder', () => {
    mockCwd = '/home/user/untrusted/src';
    mockRules['/home/user/untrusted'] = TrustLevel.DO_NOT_TRUST;
    expect(isWorkspaceTrusted(mockSettings)).toBe(false);
  });

  it('should return undefined when no rules match', () => {
    mockCwd = '/home/user/other';
    mockRules['/home/user/projectA'] = TrustLevel.TRUST_FOLDER;
    mockRules['/home/user/untrusted'] = TrustLevel.DO_NOT_TRUST;
    expect(isWorkspaceTrusted(mockSettings)).toBeUndefined();
  });

  it('should prioritize the more specific distrust rule', () => {
    mockCwd = '/home/user/projectA/untrusted';
    mockRules['/home/user/projectA'] = TrustLevel.TRUST_FOLDER;
    mockRules[mockCwd] = TrustLevel.DO_NOT_TRUST;
    expect(isWorkspaceTrusted(mockSettings)).toBe(false);
  });

  it('should handle path normalization', () => {
    mockCwd = '/home/user/projectA';
    mockRules[`/home/user/../user/${path.basename('/home/user/projectA')}`] =
      TrustLevel.TRUST_FOLDER;
    expect(isWorkspaceTrusted(mockSettings)).toBe(true);
  });
});

describe('isWorkspaceTrusted with IDE override', () => {
  const mockSettings: Settings = {
    folderTrust: true,
  } as Settings;

  beforeEach(() => {
    resetTrustedFoldersForTesting();
  });

  it('should return true when ideTrust is true, ignoring config', () => {
    (getIdeTrust as Mock<typeof getIdeTrust>).mockReturnValue(true);
    // Even if config says don't trust, ideTrust should win.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ [process.cwd()]: TrustLevel.DO_NOT_TRUST }),
    );
    expect(isWorkspaceTrusted(mockSettings)).toBe(true);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('should return false when ideTrust is false, ignoring config', () => {
    (getIdeTrust as Mock<typeof getIdeTrust>).mockReturnValue(false);
    // Even if config says trust, ideTrust should win.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ [process.cwd()]: TrustLevel.TRUST_FOLDER }),
    );
    expect(isWorkspaceTrusted(mockSettings)).toBe(false);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('should fall back to config when ideTrust is undefined', () => {
    (getIdeTrust as Mock<typeof getIdeTrust>).mockReturnValue(undefined);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ [process.cwd()]: TrustLevel.TRUST_FOLDER }),
    );
    expect(isWorkspaceTrusted(mockSettings)).toBe(true);
  });

  it('should always return true if folderTrust setting is disabled', () => {
    const settings: Settings = {
      folderTrust: false,
    } as Settings;
    (getIdeTrust as Mock<typeof getIdeTrust>).mockReturnValue(false);
    expect(isWorkspaceTrusted(settings)).toBe(true);
  });
});

describe('Trusted Folders Caching', () => {
  beforeEach(() => {
    resetTrustedFoldersForTesting();
    (fs.existsSync as Mock<typeof fs.existsSync>).mockReturnValue(true);
    (fs.readFileSync as Mock<typeof fs.readFileSync>).mockReturnValue('{}');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should cache the loaded folders object', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');

    // First call should read the file
    loadTrustedFolders();
    expect(readSpy).toHaveBeenCalledTimes(1);

    // Second call should use the cache
    loadTrustedFolders();
    expect(readSpy).toHaveBeenCalledTimes(1);

    // Resetting should clear the cache
    resetTrustedFoldersForTesting();

    // Third call should read the file again
    loadTrustedFolders();
    expect(readSpy).toHaveBeenCalledTimes(2);
  });
});

describe('invalid trust levels', () => {
  const mockCwd = '/user/folder';
  const mockRules: Record<string, TrustLevel> = {};

  beforeEach(() => {
    resetTrustedFoldersForTesting();
    // Stated explicitly: these cases exercise the configuration path, which is
    // only reached when the IDE expresses no opinion. An earlier describe
    // configures getIdeTrust, and that mock is shared across the whole file.
    (getIdeTrust as Mock<typeof getIdeTrust>).mockReturnValue(undefined);
    vi.spyOn(process, 'cwd').mockImplementation(() => mockCwd);
    vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p === getTrustedFoldersPath()) {
        return JSON.stringify(mockRules);
      }
      return '{}';
    });
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => p === getTrustedFoldersPath(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear the object
    Object.keys(mockRules).forEach((key) => delete mockRules[key]);
  });

  it('should create a comprehensive error message for invalid trust level', () => {
    mockRules[mockCwd] = 'INVALID_TRUST_LEVEL' as TrustLevel;

    const { errors } = loadTrustedFolders();
    const possibleValues = Object.values(TrustLevel).join(', ');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe(
      `Invalid trust level "INVALID_TRUST_LEVEL" for path "${mockCwd}". Possible values are: ${possibleValues}.`,
    );
  });

  it('should throw a fatal error for invalid trust level', () => {
    const mockSettings: Settings = {
      folderTrust: true,
    };
    mockRules[mockCwd] = 'INVALID_TRUST_LEVEL' as TrustLevel;

    expect(() => isWorkspaceTrusted(mockSettings)).toThrow(FatalConfigError);
  });
});
