/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { createDeferred } from '../../test-utils/async.js';
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
  ReturnType<
    typeof vi.fn<(folderPath: string) => ResolvedTrustRule | undefined>
  >
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
      entries: Object.entries(mockedUserConfig.value).filter(
        ([entryPath]) => entryPath === folderPath,
      ),
    }));
    mockedRestoreSnapshot.mockImplementation(
      (snapshot: {
        canonicalPath: string;
        entries: ReadonlyArray<readonly [string, TrustLevel]>;
      }) => {
        mockedUserConfig.value = Object.fromEntries([
          ...Object.entries(mockedUserConfig.value).filter(
            ([entryPath]) => entryPath !== snapshot.canonicalPath,
          ),
          ...snapshot.entries,
        ]);
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

  it('preserves unrelated rule changes while rolling back a live failure', async () => {
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn().mockImplementation(() => {
        mockedUserConfig.value['/unrelated'] = TrustLevel.TRUST_PARENT;
        throw new Error('live update failed');
      }),
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedUserConfig.value).toStrictEqual({
      '/unrelated': TrustLevel.TRUST_PARENT,
    });
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

  it('does not publish a completed commit into a different working directory', async () => {
    mockedUserConfig.value = {
      '/workspace/first': TrustLevel.DO_NOT_TRUST,
      '/workspace/second': TrustLevel.DO_NOT_TRUST,
    };
    const liveUpdate = createDeferred<void>();
    let workingDirectory = '/workspace/first';
    let liveTrust = false;
    const setTrustedFolderLive = vi.fn(async (trusted: boolean) => {
      await liveUpdate.promise;
      liveTrust = trusted;
    });
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => workingDirectory,
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => liveTrust,
      setTrustedFolderLive,
    };
    const { result, rerender } = renderHook(() =>
      usePermissionsModifyTrust(config),
    );

    let commit: ReturnType<typeof result.current.commitTrustLevel>;
    act(() => {
      commit = result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });
    await vi.waitFor(() => expect(setTrustedFolderLive).toHaveBeenCalledOnce());

    workingDirectory = '/workspace/second';
    rerender();
    expect(result.current.workingDirectory).toBe('/workspace/second');
    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);

    liveUpdate.resolve();
    await act(async () => {
      await commit;
    });

    expect(result.current.workingDirectory).toBe('/workspace/second');
    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.committedTrustLevel).toBeUndefined();
    expect(result.current.effectiveTrust).toBe(false);
  });

  it('serializes concurrent commits and preserves the final selection', async () => {
    const firstLiveUpdate = createDeferred<void>();
    let liveTrust = false;
    const setTrustedFolderLive = vi
      .fn<(trusted: boolean) => Promise<void>>()
      .mockImplementationOnce(async (trusted) => {
        await firstLiveUpdate.promise;
        liveTrust = trusted;
      })
      .mockImplementation(async (trusted) => {
        liveTrust = trusted;
      });
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => liveTrust,
      setTrustedFolderLive,
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    let firstCommit: ReturnType<typeof result.current.commitTrustLevel>;
    let secondCommit: ReturnType<typeof result.current.commitTrustLevel>;
    act(() => {
      firstCommit = result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
      secondCommit = result.current.commitTrustLevel(TrustLevel.DO_NOT_TRUST);
    });
    await vi.waitFor(() => expect(setTrustedFolderLive).toHaveBeenCalledOnce());

    expect(mockedUserConfig.value['/configured/workspace']).toBe(
      TrustLevel.TRUST_FOLDER,
    );
    firstLiveUpdate.resolve();
    await act(async () => {
      await Promise.all([firstCommit, secondCommit]);
    });

    expect(setTrustedFolderLive).toHaveBeenCalledTimes(2);
    expect(mockedUserConfig.value['/configured/workspace']).toBe(
      TrustLevel.DO_NOT_TRUST,
    );
    expect(result.current.committedTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.effectiveTrust).toBe(false);
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

  it('recomputes the winning rule after persisting a direct override', async () => {
    mockedUserConfig.value = {
      '/workspace': TrustLevel.TRUST_FOLDER,
    };
    mockedResolvePathTrust.mockImplementation((folderPath: string) => {
      if (folderPath in mockedUserConfig.value) {
        const directLevel = mockedUserConfig.value[folderPath];
        return {
          rule: { path: folderPath, trustLevel: directLevel },
          effectivePath: folderPath,
          trusted: directLevel !== TrustLevel.DO_NOT_TRUST,
          provenance: 'direct',
        };
      }
      return {
        rule: { path: '/workspace', trustLevel: TrustLevel.TRUST_FOLDER },
        effectivePath: '/workspace',
        trusted: true,
        provenance: 'inherited',
      };
    });
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/workspace/project',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
      setTrustedFolderLive: vi.fn(),
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.isParentTrusted).toBe(true);

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.DO_NOT_TRUST);
    });

    expect(result.current.isParentTrusted).toBe(false);
    expect(result.current.effectiveLocalTrustLevel).toBe(
      TrustLevel.DO_NOT_TRUST,
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
