/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { useFolderTrust } from './useFolderTrust.js';
import type { LoadedSettings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { LoadedTrustedFolders } from '../../config/trustedFolders.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import * as trustedFolders from '../../config/trustedFolders.js';
import { ideContext } from '@vybestack/llxprt-code-core';

const mockedCwd = vi.hoisted(() => vi.fn());

vi.mock('node:process', async () => {
  const actual =
    await vi.importActual<typeof import('node:process')>('node:process');
  return {
    ...actual,
    cwd: mockedCwd,
    platform: 'linux',
  };
});

describe('useFolderTrust', () => {
  let mockSettings: LoadedSettings;
  let mockTrustedFolders: LoadedTrustedFolders;
  let loadTrustedFoldersSpy: vi.SpyInstance;
  let isWorkspaceTrustedSpy: vi.SpyInstance;
  let addItem: vi.Mock;
  let mockConfig: {
    setTrustedFolderLive: vi.Mock;
    getWorkingDir: () => string;
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
    ideContext.clearIdeContext();

    loadTrustedFoldersSpy = vi
      .spyOn(trustedFolders, 'loadTrustedFolders')
      .mockReturnValue(mockTrustedFolders);
    isWorkspaceTrustedSpy = vi.spyOn(trustedFolders, 'isWorkspaceTrusted');
    mockedCwd.mockReturnValue('/test/path');
    addItem = vi.fn();
    mockConfig = {
      setTrustedFolderLive: vi.fn(),
      getWorkingDir: () => '/test/path',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not open dialog when folder is already trusted', () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should not open dialog when folder is already untrusted', () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should open dialog when folder trust is undefined', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should send a message if the folder is untrusted', () => {
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

  it('should close dialog and call setTrustedFolderLive(true) for TRUST_FOLDER', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(loadTrustedFoldersSpy).toHaveBeenCalled();
    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      mockConfig.getWorkingDir(),
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
  });

  it('should close dialog and call setTrustedFolderLive(true) for TRUST_PARENT', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_PARENT);
    });

    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      mockConfig.getWorkingDir(),
      TrustLevel.TRUST_PARENT,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
  });

  it('should close dialog and call setTrustedFolderLive(false) for DO_NOT_TRUST', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    act(() => {
      // After persisting DO_NOT_TRUST, the canonical resolver returns false.
      result.current.handleFolderTrustSelect(FolderTrustChoice.DO_NOT_TRUST);
    });

    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      mockConfig.getWorkingDir(),
      TrustLevel.DO_NOT_TRUST,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(false);
  });

  it('should do nothing for default choice', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    act(() => {
      result.current.handleFolderTrustSelect(
        'invalid_choice' as FolderTrustChoice,
      );
    });

    expect(mockTrustedFolders.setValue).not.toHaveBeenCalled();
    expect(mockSettings.setValue).not.toHaveBeenCalled();
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
    expect(mockConfig.setTrustedFolderLive).not.toHaveBeenCalled();
  });

  it('should call setTrustedFolderLive(true) when gaining trust', () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    act(() => {
      // After persisting TRUST_FOLDER, the canonical resolver returns true.
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(true);
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should call setTrustedFolderLive(false) when revoking trust', () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, addItem, mockConfig),
    );

    act(() => {
      // After persisting DO_NOT_TRUST, the canonical resolver returns false.
      result.current.handleFolderTrustSelect(FolderTrustChoice.DO_NOT_TRUST);
    });

    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(false);
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should not call setTrustedFolderLive when no config is provided', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    const { result } = renderHook(() => useFolderTrust(mockSettings, addItem));

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('uses the configured working directory when it differs from process cwd', () => {
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

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      configuredWorkingDirectory,
      TrustLevel.TRUST_FOLDER,
    );
  });
});
