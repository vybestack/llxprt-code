/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { useFolderTrust } from './useFolderTrust.js';
import { LoadedSettings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import type { LoadedTrustedFolders } from '../../config/trustedFolders.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import { Config } from '@vybestack/llxprt-code-core';
import * as trustedFolders from '../../config/trustedFolders.js';

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
  let mockConfig: Config;
  let mockTrustedFolders: LoadedTrustedFolders;
  let loadTrustedFoldersSpy: vi.SpyInstance;
  let isWorkspaceTrustedSpy: vi.SpyInstance;
  let addItem: vi.Mock;

  beforeEach(() => {
    mockSettings = {
      merged: {
        folderTrustFeature: true,
        folderTrust: undefined,
      },
      setValue: vi.fn(),
    } as unknown as LoadedSettings;

    mockConfig = {
      isTrustedFolder: vi.fn(),
    } as unknown as Config;

    mockTrustedFolders = {
      setValue: vi.fn(),
    } as unknown as LoadedTrustedFolders;

    loadTrustedFoldersSpy = vi
      .spyOn(trustedFolders, 'loadTrustedFolders')
      .mockReturnValue(mockTrustedFolders);
    isWorkspaceTrustedSpy = vi.spyOn(trustedFolders, 'isWorkspaceTrusted');
    mockedCwd.mockReturnValue('/test/path');
    addItem = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not open dialog when folder is already trusted', () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should not open dialog when folder is already untrusted', () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(false);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });

  it('should open dialog when folder trust is undefined', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should send a message if the folder is untrusted', () => {
    isWorkspaceTrustedSpy.mockReturnValue(false);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(false);
    renderHook(() => useFolderTrust(mockSettings, mockConfig, addItem));
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
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(true);
    renderHook(() => useFolderTrust(mockSettings, mockConfig, addItem));
    expect(addItem).not.toHaveBeenCalled();
  });

  it('should handle TRUST_FOLDER choice', () => {
    isWorkspaceTrustedSpy
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(true);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );

    isWorkspaceTrustedSpy.mockReturnValue(true);
    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(loadTrustedFoldersSpy).toHaveBeenCalled();
    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      process.cwd(),
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    // Config trust state is managed by trustedFolders, not directly on config
  });

  it('should handle TRUST_PARENT choice', () => {
    isWorkspaceTrustedSpy
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(true);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_PARENT);
    });

    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      process.cwd(),
      TrustLevel.TRUST_PARENT,
    );
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
    // Config trust state is managed by trustedFolders, not directly on config
  });

  it('should handle DO_NOT_TRUST choice and trigger restart', () => {
    isWorkspaceTrustedSpy
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(false);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.DO_NOT_TRUST);
    });

    expect(mockTrustedFolders.setValue).toHaveBeenCalledWith(
      process.cwd(),
      TrustLevel.DO_NOT_TRUST,
    );
    // Config trust state is managed by trustedFolders, not directly on config
    expect(result.current.isRestarting).toBe(true);
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should do nothing for default choice', () => {
    isWorkspaceTrustedSpy.mockReturnValue(undefined);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );

    act(() => {
      result.current.handleFolderTrustSelect(
        'invalid_choice' as FolderTrustChoice,
      );
    });

    expect(mockTrustedFolders.setValue).not.toHaveBeenCalled();
    expect(mockSettings.setValue).not.toHaveBeenCalled();
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should set isRestarting to true when trust status changes from false to true', () => {
    isWorkspaceTrustedSpy.mockReturnValueOnce(false).mockReturnValueOnce(true); // Initially untrusted, then trusted
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(false);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(result.current.isRestarting).toBe(true);
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should set isRestarting to true when trust status changes from true to false', () => {
    isWorkspaceTrustedSpy.mockReturnValueOnce(true).mockReturnValueOnce(false); // Initially trusted, then untrusted
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig, addItem),
    );

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.DO_NOT_TRUST);
    });

    expect(result.current.isRestarting).toBe(true);
    expect(result.current.isFolderTrustDialogOpen).toBe(true);
  });

  it('should not set isRestarting when trust status remains the same', () => {
    isWorkspaceTrustedSpy.mockReturnValue(true);
    (mockConfig.isTrustedFolder as vi.Mock).mockReturnValue(true);
    const { result } = renderHook(() =>
      useFolderTrust(mockSettings, mockConfig),
    );

    // No need to reset mock since setIsTrustedFolder is no longer called

    act(() => {
      result.current.handleFolderTrustSelect(FolderTrustChoice.TRUST_FOLDER);
    });

    expect(result.current.isRestarting).toBe(false);
    expect(result.current.isFolderTrustDialogOpen).toBe(false);
  });
});
