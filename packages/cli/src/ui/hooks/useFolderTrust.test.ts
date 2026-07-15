/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { type FolderTrustRuntime, useFolderTrust } from './useFolderTrust.js';
import { ExitCodes } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { LoadedTrustedFolders } from '../../config/trustedFolders.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import * as trustedFolders from '../../config/trustedFolders.js';

const mockedCwd = vi.hoisted(() => vi.fn());
const mockedExit = vi.hoisted(() => vi.fn());
const temporaryDirectories: string[] = [];

vi.mock('node:process', async () => {
  const actual =
    await vi.importActual<typeof import('node:process')>('node:process');
  return {
    ...actual,
    cwd: mockedCwd,
    exit: mockedExit,
    platform: 'linux',
  };
});

describe('useFolderTrust', () => {
  let mockSettings: LoadedSettings;
  let mockTrustedFolders: LoadedTrustedFolders;
  let loadTrustedFoldersSpy: vi.SpyInstance;
  let isWorkspaceTrustedSpy: vi.SpyInstance;
  let addItem: vi.Mock;
  let mockConfig: FolderTrustRuntime & {
    setTrustedFolderLive: vi.Mock;
  };

  beforeEach(() => {
    mockSettings = {
      merged: {
        folderTrust: true,
      },
      setValue: vi.fn(),
    } as unknown as LoadedSettings;

    mockTrustedFolders = new trustedFolders.LoadedTrustedFolders(
      { path: '/test/trustedFolders.json', config: {} },
      [],
    );
    vi.spyOn(mockTrustedFolders, 'setValue').mockImplementation(
      (folderPath, trustLevel) => {
        mockTrustedFolders.user.config[folderPath] = trustLevel;
      },
    );
    vi.spyOn(mockTrustedFolders, 'snapshotValue').mockImplementation(
      (folderPath) => ({
        canonicalPath: folderPath,
        entries: Object.entries(mockTrustedFolders.user.config).filter(
          ([entryPath]) => entryPath === folderPath,
        ),
      }),
    );
    vi.spyOn(mockTrustedFolders, 'restoreSnapshot').mockImplementation(
      (snapshot) => {
        mockTrustedFolders.user.config = Object.fromEntries([
          ...Object.entries(mockTrustedFolders.user.config).filter(
            ([entryPath]) => entryPath !== snapshot.canonicalPath,
          ),
          ...snapshot.entries,
        ]);
      },
    );
    vi.spyOn(mockTrustedFolders, 'isPathTrusted').mockImplementation(
      (folderPath) =>
        mockTrustedFolders.user.config[folderPath] !== TrustLevel.DO_NOT_TRUST,
    );

    loadTrustedFoldersSpy = vi
      .spyOn(trustedFolders, 'loadTrustedFolders')
      .mockReturnValue(mockTrustedFolders);
    isWorkspaceTrustedSpy = vi.spyOn(trustedFolders, 'isWorkspaceTrusted');
    mockedCwd.mockReturnValue('/test/path');
    addItem = vi.fn();
    mockConfig = {
      setTrustedFolderLive: vi.fn().mockResolvedValue(undefined),
      getWorkingDir: () => '/test/path',
      isTrustedFolder: () => false,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('should not open dialog when folder is already trusted', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should not open dialog when folder is already untrusted', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should open dialog when folder trust is undefined', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should send a message if the folder is untrusted', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    renderHook(() => useFolderTrust(mockSettings, addItem, mockConfig));
    expect(addItem).toHaveBeenCalledWith(
      {
        text: 'This folder is not trusted. Some features may be disabled. Use the `/permissions` command to change the trust level.',
        type: 'info',
      },
      expect.any(Number),
    );
  });

  it('should not send a message if the folder is trusted', () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    renderHook(() => useFolderTrust(mockSettings, addItem, mockConfig));
    expect(addItem).not.toHaveBeenCalled();
  });

  it('should close dialog and call setTrustedFolderLive(true) for TRUST_FOLDER', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_FOLDER,
      );
    });

    expect(loadTrustedFoldersSpy).toHaveBeenCalled();
    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      mockConfig.getWorkingDir(),
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
  });

  it('should close dialog and call setTrustedFolderLive(true) for TRUST_PARENT', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_PARENT,
      );
    });

    expect(loadTrustedFoldersSpy).toHaveBeenCalled();
    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      mockConfig.getWorkingDir(),
      TrustLevel.TRUST_PARENT,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
  });

  it('should close dialog and call setTrustedFolderLive(false) for DO_NOT_TRUST', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      // Persisting DO_NOT_TRUST updates the loaded config before local trust is resolved.
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.DO_NOT_TRUST,
      );
    });

    expect(loadTrustedFoldersSpy).toHaveBeenCalled();
    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      mockConfig.getWorkingDir(),
      TrustLevel.DO_NOT_TRUST,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(false);
  });

  it('should do nothing for default choice', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        'invalid_choice' as FolderTrustChoice,
      );
    });

    expect(mockTrustedFolders.setValue).not.toHaveBeenCalled();
    expect(mockSettings.setValue).not.toHaveBeenCalled();
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
    expect(mockConfig.setTrustedFolderLive).not.toHaveBeenCalled();
  });

  it('should call setTrustedFolderLive(true) when gaining trust', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      // Persisting TRUST_FOLDER updates the loaded config before local trust is resolved.
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_FOLDER,
      );
    });

    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should call setTrustedFolderLive(false) when revoking trust', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      // Persisting DO_NOT_TRUST updates the loaded config before local trust is resolved.
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.DO_NOT_TRUST,
      );
    });

    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(false);
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should not call setTrustedFolderLive when no config is provided', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() => useFolderTrust(mockSettings, addItem));

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_FOLDER,
      );
    });

    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('reports persistence failures and exits with a fatal config error', async () => {
    vi.useFakeTimers();
    try {
      isWorkspaceTrustedSpy.mockReturnValue(undefined);
      loadTrustedFoldersSpy.mockImplementationOnce(() => {
        throw new Error('cannot read trusted folders');
      });
      const { result } = renderHook(() =>
        useFolderTrust(mockSettings, addItem, mockConfig),
      );

      await act(async () => {
        await result.current.handleFolderTrustSelect(
          FolderTrustChoice.TRUST_FOLDER,
        );
      });

      expect(addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: expect.stringContaining('cannot read trusted folders'),
        }),
        expect.any(Number),
      );
      expect(mockedExit).not.toHaveBeenCalled();
      await expect(vi.advanceTimersByTimeAsync(100)).rejects.toThrow(
        `process.exit unexpectedly called with "${ExitCodes.FATAL_CONFIG_ERROR}"`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores persisted and live trust after live application fails', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    mockTrustedFolders.user.config['/test/path'] = TrustLevel.DO_NOT_TRUST;
    mockConfig.setTrustedFolderLive
      .mockRejectedValueOnce(new Error('live update failed'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_FOLDER,
      );
    });

    expect(mockTrustedFolders.user.config).toStrictEqual({
      '/test/path': TrustLevel.DO_NOT_TRUST,
    });
    expect(mockConfig.setTrustedFolderLive).toHaveBeenNthCalledWith(1, true);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenNthCalledWith(2, false);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('live update failed'),
      }),
      expect.any(Number),
    );
  });

  it('reports incomplete rollback when restoring live trust also fails', async () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    mockConfig.setTrustedFolderLive
      .mockRejectedValueOnce(new Error('live update failed'))
      .mockRejectedValueOnce(new Error('live rollback failed'));
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_FOLDER,
      );
    });

    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('rollback was incomplete'),
      }),
      expect.any(Number),
    );
  });

  it.skipIf(process.platform === 'win32')(
    'persists a symlinked workspace canonically before updating live Config trust',
    async () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'llxprt-live-folder-trust-'),
      );
      temporaryDirectories.push(directory);
      const target = path.join(directory, 'target');
      const workspaceLink = path.join(directory, 'workspace-link');
      const trustedFoldersPath = path.join(directory, 'trustedFolders.json');
      fs.mkdirSync(target);
      fs.symlinkSync(target, workspaceLink, 'dir');
      const canonicalTarget = fs.realpathSync(target);
      const liveTrustedFolders = new trustedFolders.LoadedTrustedFolders(
        { path: trustedFoldersPath, config: {} },
        [],
      );
      loadTrustedFoldersSpy.mockReturnValue(liveTrustedFolders);
      isWorkspaceTrustedSpy.mockReturnValue(undefined);
      mockConfig.getWorkingDir = () => workspaceLink;

      const { result } = renderHook(() =>
        useFolderTrust(mockSettings, addItem, mockConfig),
      );
      await act(async () => {
        await result.current.handleFolderTrustSelect(
          FolderTrustChoice.TRUST_FOLDER,
        );
      });

      expect(liveTrustedFolders.user.config).toStrictEqual({
        [canonicalTarget]: TrustLevel.TRUST_FOLDER,
      });
      expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
    },
  );

  it('uses the configured working directory when it differs from process cwd', async () => {
    const configuredWorkingDirectory = '/workspace/from-config';
    mockedCwd.mockReturnValue('/unrelated/process-cwd');
    mockConfig.getWorkingDir = () => configuredWorkingDirectory;
    isWorkspaceTrustedSpy.mockImplementation((_settings, workingDirectory) =>
      workingDirectory === configuredWorkingDirectory ? undefined : true,
    );
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    expect(result.current.isFolderTrustDialogOpen).toBe(true);

    await act(async () => {
      await result.current.handleFolderTrustSelect(
        FolderTrustChoice.TRUST_FOLDER,
      );
    });

    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      configuredWorkingDirectory,
      TrustLevel.TRUST_FOLDER,
    );
  });
});
