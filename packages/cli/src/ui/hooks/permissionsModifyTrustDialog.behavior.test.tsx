/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import {
  TrustLevel,
  type ResolvedTrustRule,
} from '../../config/trustedFolders.js';
import type { PermissionsTrustRuntime } from './usePermissionsModifyTrust.js';
const mockedSetValue = vi.hoisted(() => vi.fn());
const mockedDeleteValue = vi.hoisted(() => vi.fn());
const mockedUserConfig = vi.hoisted<{
  value: Record<string, TrustLevel>;
}>(() => ({ value: {} }));
const mockedResolvePathTrust = vi.hoisted<
  ReturnType<typeof vi.fn<() => ResolvedTrustRule | undefined>>
>(() => vi.fn(() => undefined));
const mockedGetValue = vi.hoisted(() =>
  vi.fn((folderPath: string) => mockedUserConfig.value[folderPath]),
);
const mockedSnapshotValue = vi.hoisted(() => vi.fn());
const mockedRestoreSnapshot = vi.hoisted(() => vi.fn());
const mockedIdeTrust = vi.hoisted<{ value: boolean | undefined }>(() => ({
  value: undefined,
}));

vi.mock('../../config/trustedFolders.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../config/trustedFolders.js')
  >('../../config/trustedFolders.js');
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      user: {
        path: '/mock/trustedFolders.json',
        config: mockedUserConfig.value,
      },
      errors: [],
      rules: [],
      setValue: mockedSetValue,
      deleteValue: mockedDeleteValue,
      getValue: mockedGetValue,
      snapshotValue: mockedSnapshotValue,
      restoreSnapshot: mockedRestoreSnapshot,
      resolvePathTrust: mockedResolvePathTrust,
      isPathTrusted: vi.fn(() => undefined),
    })),
  };
});

vi.mock('./useIdeTrustListener.js', () => ({
  useIdeTrustListener: () => ({ isIdeTrusted: mockedIdeTrust.value }),
}));

import { usePermissionsModifyTrust } from './usePermissionsModifyTrust.js';

describe('PermissionsModifyTrustDialog trust provenance', () => {
  beforeEach(() => {
    mockedSetValue.mockReset();
    mockedDeleteValue.mockReset();
    mockedGetValue.mockReset();
    mockedSnapshotValue.mockReset();
    mockedRestoreSnapshot.mockReset();
    mockedUserConfig.value = {};
    mockedIdeTrust.value = undefined;
    mockedGetValue.mockImplementation(
      (folderPath: string) => mockedUserConfig.value[folderPath],
    );
    mockedSnapshotValue.mockImplementation((folderPath: string) => ({
      canonicalPath: folderPath,
      entries: Object.entries(mockedUserConfig.value),
    }));
    mockedRestoreSnapshot.mockImplementation(
      (snapshot: { entries: ReadonlyArray<readonly [string, TrustLevel]> }) => {
        mockedUserConfig.value = Object.fromEntries(snapshot.entries);
      },
    );
    mockedResolvePathTrust.mockReset();
    mockedResolvePathTrust.mockReturnValue(undefined);
    mockedSetValue.mockImplementation((folderPath, trustLevel) => {
      mockedUserConfig.value[folderPath] = trustLevel;
    });
    mockedDeleteValue.mockImplementation((folderPath) => {
      delete mockedUserConfig.value[folderPath];
    });
  });

  it('does not report inherited local trust while IDE trust is authoritative', () => {
    mockedResolvePathTrust.mockReturnValue({
      rule: { path: '/configured', trustLevel: TrustLevel.TRUST_FOLDER },
      effectivePath: '/configured',
      trusted: true,
      provenance: 'inherited',
    });
    mockedIdeTrust.value = true;
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => true,
      setTrustedFolderLive: vi.fn(),
    };

    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.isIdeTrusted).toBe(true);
    expect(result.current.isParentTrusted).toBe(false);
  });

  it('reports a rolled-back live failure and remains usable after retry', async () => {
    const setTrustedFolderLive = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('live update failed');
      })
      .mockImplementation(() => undefined);
    let liveTrust = true;
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => liveTrust,
      setTrustedFolderLive: async (trusted) => {
        await setTrustedFolderLive(trusted);
        liveTrust = trusted;
      },
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    let firstResult: Awaited<
      ReturnType<typeof result.current.commitTrustLevel>
    > | null = null;
    await act(async () => {
      firstResult = await result.current.commitTrustLevel(
        TrustLevel.TRUST_FOLDER,
      );
    });

    expect(firstResult).toMatchObject({ success: false, phase: 'live' });
    expect(result.current.effectiveTrust).toBe(true);
    expect(mockedSetValue).toHaveBeenCalledWith(
      '/configured/workspace',
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.committedTrustLevel).toBeUndefined();
    expect(mockedRestoreSnapshot).toHaveBeenCalledOnce();
    expect(mockedUserConfig.value).toStrictEqual({});

    await act(async () => {
      expect(
        await result.current.commitTrustLevel(TrustLevel.DO_NOT_TRUST),
      ).toStrictEqual({ success: true });
    });
    expect(mockedSetValue).toHaveBeenCalledTimes(2);
    expect(setTrustedFolderLive).toHaveBeenCalledTimes(3);
    expect(result.current.committedTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.effectiveTrust).toBe(false);
  });

  it('preserves the pending selection when persistence fails', async () => {
    mockedUserConfig.value = {
      '/configured/workspace': TrustLevel.DO_NOT_TRUST,
    };
    mockedSetValue.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn(),
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    await act(async () => {
      expect(
        await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER),
      ).toMatchObject({ success: false, phase: 'persistence' });
    });

    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.committedTrustLevel).toBeUndefined();
  });

  it('reads and persists the direct rule by normalized working directory', async () => {
    mockedUserConfig.value = {
      '/configured/workspace': TrustLevel.DO_NOT_TRUST,
    };
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/child/../workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn(),
    };

    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.workingDirectory).toBe('/configured/workspace');
    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });
    expect(mockedSetValue).toHaveBeenCalledWith(
      '/configured/workspace',
      TrustLevel.TRUST_FOLDER,
    );
  });

  it('resets dialog trust state when the runtime working directory changes', async () => {
    mockedUserConfig.value = {
      '/workspace/first': TrustLevel.TRUST_FOLDER,
      '/workspace/second': TrustLevel.DO_NOT_TRUST,
    };
    const firstConfig: PermissionsTrustRuntime = {
      getWorkingDir: () => '/workspace/first',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => true,
      setTrustedFolderLive: vi.fn(),
    };
    const secondConfig: PermissionsTrustRuntime = {
      getWorkingDir: () => '/workspace/second',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ config }) => usePermissionsModifyTrust(config),
      { initialProps: { config: firstConfig } },
    );

    expect(result.current.pendingTrustLevel).toBe(TrustLevel.TRUST_FOLDER);
    expect(result.current.effectiveTrust).toBe(true);
    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });
    expect(result.current.committedTrustLevel).toBe(TrustLevel.TRUST_FOLDER);

    rerender({ config: secondConfig });

    expect(result.current.workingDirectory).toBe('/workspace/second');
    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.effectiveTrust).toBe(false);
    expect(result.current.committedTrustLevel).toBeUndefined();
  });

  it('restores the exact saved rule when live application throws', async () => {
    mockedUserConfig.value = {
      '/configured/workspace': TrustLevel.DO_NOT_TRUST,
    };
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn().mockImplementation(() => {
        throw new Error('live update failed');
      }),
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedSetValue).toHaveBeenCalledExactlyOnceWith(
      '/configured/workspace',
      TrustLevel.TRUST_FOLDER,
    );
    expect(mockedRestoreSnapshot).toHaveBeenCalledOnce();
    expect(mockedDeleteValue).not.toHaveBeenCalled();
    expect(mockedUserConfig.value['/configured/workspace']).toBe(
      TrustLevel.DO_NOT_TRUST,
    );
  });

  it('saves a direct cwd rule when selecting the same level as inherited trust', async () => {
    mockedUserConfig.value = {
      '/workspace': TrustLevel.TRUST_FOLDER,
    };
    mockedResolvePathTrust.mockReturnValue({
      rule: { path: '/workspace', trustLevel: TrustLevel.TRUST_FOLDER },
      effectivePath: '/workspace',
      trusted: true,
      provenance: 'inherited',
    });
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/workspace/project',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => true,
      setTrustedFolderLive: vi.fn(),
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.pendingTrustLevel).toBeUndefined();
    expect(result.current.isParentTrusted).toBe(true);
    expect(result.current.effectiveLocalTrustLevel).toBe(
      TrustLevel.TRUST_FOLDER,
    );

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      '/workspace/project',
      TrustLevel.TRUST_FOLDER,
    );
  });

  it('reflects inherited DO_NOT_TRUST in effectiveLocalTrustLevel when the form opens', async () => {
    mockedUserConfig.value = {
      '/workspace': TrustLevel.DO_NOT_TRUST,
    };
    mockedResolvePathTrust.mockReturnValue({
      rule: { path: '/workspace', trustLevel: TrustLevel.DO_NOT_TRUST },
      effectivePath: '/workspace',
      trusted: false,
      provenance: 'inherited',
    });
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/workspace/project',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn(),
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.pendingTrustLevel).toBeUndefined();
    expect(result.current.isParentTrusted).toBe(true);
    expect(result.current.effectiveLocalTrustLevel).toBe(
      TrustLevel.DO_NOT_TRUST,
    );
    expect(result.current.effectiveTrust).toBe(false);
  });
});
