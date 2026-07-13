/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import type { PermissionsTrustRuntime } from './usePermissionsModifyTrust.js';
import {
  getTrustCommitErrorMessage,
  getTrustLevelDisplay,
  getTrustUpdateDisplay,
  getWarningMessage,
  shouldDismissTrustDialog,
} from '../components/PermissionsModifyTrustDialog.js';
const mockedSetValue = vi.hoisted(() => vi.fn());
const mockedDeleteValue = vi.hoisted(() => vi.fn());
const mockedUserConfig = vi.hoisted<{
  value: Record<string, TrustLevel>;
}>(() => ({ value: {} }));

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
      resolvePathTrust: vi.fn(() => undefined),
      isPathTrusted: vi.fn(() => undefined),
    })),
  };
});

vi.mock('./useIdeTrustListener.js', () => ({
  useIdeTrustListener: () => ({ isIdeTrusted: undefined }),
}));

import { usePermissionsModifyTrust } from './usePermissionsModifyTrust.js';

describe('PermissionsModifyTrustDialog trust provenance', () => {
  beforeEach(() => {
    mockedSetValue.mockReset();
    mockedDeleteValue.mockReset();
    mockedUserConfig.value = {};
    mockedSetValue.mockImplementation((folderPath, trustLevel) => {
      mockedUserConfig.value[folderPath] = trustLevel;
    });
    mockedDeleteValue.mockImplementation((folderPath) => {
      delete mockedUserConfig.value[folderPath];
    });
  });

  it('represents an IDE false override', () => {
    expect(getTrustLevelDisplay(TrustLevel.TRUST_FOLDER, false, false)).toBe(
      'Not trusted (via IDE)',
    );
  });

  it('distinguishes a saved local fallback from the live IDE override', () => {
    expect(
      getTrustUpdateDisplay(TrustLevel.TRUST_FOLDER, false, false),
    ).toStrictEqual({
      savedLocalFallback: 'Trusted',
      effectiveNow: 'Not trusted (via IDE)',
    });
  });

  it('represents inherited DO_NOT_TRUST as inherited untrusted', () => {
    expect(getTrustLevelDisplay(TrustLevel.DO_NOT_TRUST, undefined, true)).toBe(
      'Not trusted (via parent folder)',
    );
    expect(
      getWarningMessage(undefined, true, TrustLevel.DO_NOT_TRUST),
    ).toContain('This folder is not trusted via a parent folder setting.');
  });

  it('represents inherited trust when no direct trust level is set', () => {
    expect(getTrustLevelDisplay(undefined, undefined, true)).toBe(
      'Trusted (via parent folder)',
    );
  });
  it('requires Enter to dismiss the updated prompt while preserving Escape', () => {
    expect([
      shouldDismissTrustDialog(true, 'x'),
      shouldDismissTrustDialog(true, 'return'),
      shouldDismissTrustDialog(false, 'escape'),
    ]).toStrictEqual([false, true, true]);
  });

  it('reports a rolled-back live failure and remains usable after retry', () => {
    const setTrustedFolderLive = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('live update failed');
      })
      .mockImplementation(() => undefined);
    const config: PermissionsTrustRuntime = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => true,
      setTrustedFolderLive,
    };
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    let firstResult: ReturnType<typeof result.current.commitTrustLevel> | null =
      null;
    act(() => {
      firstResult = result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(firstResult).toMatchObject({ success: false, phase: 'live' });
    expect(result.current.effectiveTrust).toBe(true);
    expect(mockedSetValue).toHaveBeenCalledWith(
      '/configured/workspace',
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.committedTrustLevel).toBeUndefined();
    expect(mockedDeleteValue).toHaveBeenCalledExactlyOnceWith(
      '/configured/workspace',
    );
    expect(
      getTrustCommitErrorMessage('live', new Error('live update failed')),
    ).toBe(
      'Trust settings could not be applied live, so the saved setting was restored: live update failed',
    );

    act(() => {
      expect(
        result.current.commitTrustLevel(TrustLevel.DO_NOT_TRUST),
      ).toStrictEqual({ success: true });
    });
    expect(mockedSetValue).toHaveBeenCalledTimes(2);
    expect(setTrustedFolderLive).toHaveBeenCalledTimes(2);
    expect(result.current.committedTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.effectiveTrust).toBe(true);
  });

  it('preserves the pending selection when persistence fails', () => {
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

    act(() => {
      expect(
        result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER),
      ).toMatchObject({ success: false, phase: 'persistence' });
    });

    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);
    expect(result.current.committedTrustLevel).toBeUndefined();
  });

  it('reads and persists the direct rule by normalized working directory', () => {
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
    act(() => {
      result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });
    expect(mockedSetValue).toHaveBeenCalledWith(
      '/configured/workspace',
      TrustLevel.TRUST_FOLDER,
    );
  });
});
