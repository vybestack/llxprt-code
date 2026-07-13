/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import {
  getTrustCommitErrorMessage,
  getTrustLevelDisplay,
  getTrustUpdateDisplay,
  getWarningMessage,
} from '../components/PermissionsModifyTrustDialog.js';
const mockedSetValue = vi.hoisted(() => vi.fn());

vi.mock('../../config/trustedFolders.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../config/trustedFolders.js')
  >('../../config/trustedFolders.js');
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      user: { path: '/mock/trustedFolders.json', config: {} },
      errors: [],
      rules: [],
      setValue: mockedSetValue,
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

  it('reports a persisted-but-not-live result and remains usable after a live setter throws', () => {
    const setTrustedFolderLive = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('live update failed');
      })
      .mockImplementation(() => undefined);
    const config = {
      getWorkingDir: () => '/configured/workspace',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => true,
      setTrustedFolderLive,
    } as unknown as CliUiRuntime;
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    let firstResult: ReturnType<typeof result.current.commitTrustLevel> | null =
      null;
    act(() => {
      firstResult = result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(firstResult).toMatchObject({ success: false, phase: 'live' });
    expect(mockedSetValue).toHaveBeenCalledWith(
      '/configured/workspace',
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.committedTrustLevel).toBe(TrustLevel.TRUST_FOLDER);
    expect(
      getTrustCommitErrorMessage('live', new Error('live update failed')),
    ).toMatch(/saved.*not.*live/i);

    act(() => {
      expect(
        result.current.commitTrustLevel(TrustLevel.DO_NOT_TRUST),
      ).toStrictEqual({ success: true });
    });
    expect(mockedSetValue).toHaveBeenCalledTimes(2);
    expect(setTrustedFolderLive).toHaveBeenCalledTimes(2);
  });
});
