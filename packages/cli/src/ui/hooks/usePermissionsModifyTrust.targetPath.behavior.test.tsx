/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import path from 'node:path';
import { renderHook } from '../../test-utils/render.js';
import {
  TrustLevel,
  type ResolvedTrustRule,
} from '../../config/trustedFolders.js';
import type { PermissionsTrustRuntime } from './usePermissionsModifyTrust.js';

const mockedSetValue = vi.fn();
const mockedDeleteValue = vi.fn();
const mockedDeleteRuleByKey = vi.fn();
const mockedUserConfig = vi.hoisted<{
  value: Record<string, TrustLevel>;
}>(() => ({ value: {} }));
const mockedResolvePathTrust = vi.hoisted<
  ReturnType<
    typeof vi.fn<(folderPath: string) => ResolvedTrustRule | undefined>
  >
>(() => vi.fn(() => undefined));
const mockedGetValue = vi.fn(
  (folderPath: string) => mockedUserConfig.value[folderPath],
);
const mockedSnapshotValue = vi.fn();
const mockedRestoreSnapshot = vi.fn();
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
      get rules() {
        return Object.entries(mockedUserConfig.value).map(
          ([rulePath, trustLevel]) => ({ path: rulePath, trustLevel }),
        );
      },
      setValue: mockedSetValue,
      deleteValue: mockedDeleteValue,
      removeRule: mockedDeleteRuleByKey,
      getValue: mockedGetValue,
      snapshotValue: mockedSnapshotValue,
      restoreSnapshot: mockedRestoreSnapshot,
      resolvePathTrust: mockedResolvePathTrust,
      isPathTrusted: (folderPath: string) =>
        mockedResolvePathTrust(folderPath)?.trusted,
    })),
  };
});

vi.mock('./useIdeTrustListener.js', () => ({
  useIdeTrustListener: () => ({ isIdeTrusted: mockedIdeTrust.value }),
}));

const actual = { ...(await import('node:os')) };
vi.mock('node:os', () => {
  return {
    ...actual,
    homedir: () => '/mock/home/user',
  };
});

import { usePermissionsModifyTrust } from './usePermissionsModifyTrust.js';

const CONFIGURED_WORKSPACE = path.resolve('/configured/workspace');
const WORKSPACE_ROOT = path.resolve('/workspace');
const WORKSPACE_FIRST = path.join(WORKSPACE_ROOT, 'first');
const WORKSPACE_PROJECT = path.join(WORKSPACE_ROOT, 'project');
const OTHER_FOLDER = path.resolve('/other/folder');
const ANCESTOR_OF_CWD = path.resolve('/work');
const CWD_PROJECT = path.join(ANCESTOR_OF_CWD, 'project');
const MOCK_HOME = '/mock/home/user';

interface RuntimeOverrides {
  workingDir: string;
  folderTrust?: boolean;
  isTrusted?: boolean | (() => boolean);
  setTrustedFolderLive?: PermissionsTrustRuntime['setTrustedFolderLive'];
}

/**
 * Builds a PermissionsTrustRuntime for a test. Only the working directory is
 * required; every other member has the value the majority of cases want, so a
 * test states just the part of the runtime it is actually exercising.
 */
function createRuntime({
  workingDir,
  folderTrust = true,
  isTrusted = false,
  setTrustedFolderLive = vi.fn(),
}: RuntimeOverrides): PermissionsTrustRuntime {
  return {
    getWorkingDir: () => workingDir,
    getFolderTrust: () => folderTrust,
    getIdeClient: () => undefined,
    isTrustedFolder: () =>
      typeof isTrusted === 'function' ? isTrusted() : isTrusted,
    setTrustedFolderLive,
  };
}

describe('target-path aware hook (issue 638 slice 2)', () => {
  beforeEach(() => {
    mockedSetValue.mockReset();
    mockedDeleteValue.mockReset();
    mockedDeleteRuleByKey.mockReset();
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
    mockedDeleteRuleByKey.mockImplementation((ruleKey: string) => {
      delete mockedUserConfig.value[ruleKey];
    });
  });

  it('B1: targetPath defaults to the normalized working directory', () => {
    const config = createRuntime({ workingDir: CONFIGURED_WORKSPACE });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.targetPath).toBe(CONFIGURED_WORKSPACE);
  });

  it('B2: setTargetPath normalizes a relative input against the working directory', () => {
    const config = createRuntime({ workingDir: WORKSPACE_ROOT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(path.join('sub', 'dir'));
    });

    expect(result.current.targetPath).toBe(
      path.resolve(WORKSPACE_ROOT, 'sub', 'dir'),
    );
  });

  it('B2: setTargetPath ignores empty or whitespace-only input', () => {
    const config = createRuntime({ workingDir: WORKSPACE_ROOT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    // Move off the working directory first, otherwise "ignored" and "reset to
    // the working directory" are indistinguishable.
    act(() => {
      result.current.setTargetPath(WORKSPACE_FIRST);
    });
    expect(result.current.targetPath).toBe(WORKSPACE_FIRST);

    act(() => {
      result.current.setTargetPath('   ');
    });

    // Empty input must leave the active target alone — it must neither resolve
    // to the working directory by way of an empty path segment nor reset it.
    expect(result.current.targetPath).toBe(WORKSPACE_FIRST);

    // The empty string is a distinct branch: path.resolve(dir, '') returns dir,
    // so an unguarded implementation would silently retarget here.
    act(() => {
      result.current.setTargetPath('');
    });

    expect(result.current.targetPath).toBe(WORKSPACE_FIRST);
  });

  it('B2: setTargetPath expands a tilde-prefixed input to the home directory', () => {
    const config = createRuntime({ workingDir: WORKSPACE_ROOT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      // Written literally rather than joined: path.join would emit "~\projects"
      // on Windows, which is a different input from the one under test.
      result.current.setTargetPath('~/projects');
    });

    // path.resolve, not path.join: the helper resolves, which on Windows adds
    // the current drive letter that path.join would omit.
    expect(result.current.targetPath).toBe(path.resolve(MOCK_HOME, 'projects'));
  });

  it('B3: effectiveLocalTrustLevel, isParentTrusted and parentFolderName derive from the current targetPath', () => {
    mockedUserConfig.value = {
      [WORKSPACE_ROOT]: TrustLevel.TRUST_FOLDER,
    };
    mockedResolvePathTrust.mockImplementation((folderPath: string) => {
      if (folderPath === WORKSPACE_PROJECT) {
        return {
          rule: {
            path: WORKSPACE_ROOT,
            trustLevel: TrustLevel.TRUST_FOLDER,
          },
          effectivePath: WORKSPACE_ROOT,
          trusted: true,
          provenance: 'inherited',
        };
      }
      return undefined;
    });
    const config = createRuntime({ workingDir: WORKSPACE_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.targetPath).toBe(WORKSPACE_PROJECT);
    expect(result.current.isParentTrusted).toBe(true);
    expect(result.current.effectiveLocalTrustLevel).toBe(
      TrustLevel.TRUST_FOLDER,
    );
    expect(result.current.parentFolderName).toBe(path.basename(WORKSPACE_ROOT));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    expect(result.current.targetPath).toBe(OTHER_FOLDER);
    expect(result.current.isParentTrusted).toBe(false);
    expect(result.current.effectiveLocalTrustLevel).toBeUndefined();
    expect(result.current.parentFolderName).toBe(
      path.basename(path.dirname(OTHER_FOLDER)),
    );
  });

  it('B3: changing targetPath resets the pending trust level to the target rule', () => {
    mockedUserConfig.value = {
      [WORKSPACE_PROJECT]: TrustLevel.DO_NOT_TRUST,
      [WORKSPACE_FIRST]: TrustLevel.TRUST_FOLDER,
    };
    mockedGetValue.mockImplementation(
      (folderPath: string) => mockedUserConfig.value[folderPath],
    );
    const config = createRuntime({ workingDir: WORKSPACE_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.pendingTrustLevel).toBe(TrustLevel.DO_NOT_TRUST);

    act(() => {
      result.current.setTargetPath(WORKSPACE_FIRST);
    });

    expect(result.current.targetPath).toBe(WORKSPACE_FIRST);
    expect(result.current.pendingTrustLevel).toBe(TrustLevel.TRUST_FOLDER);
  });

  it('B4: commitTrustLevel persists via setValue(targetPath, level)', async () => {
    mockedUserConfig.value = {
      [WORKSPACE_PROJECT]: TrustLevel.DO_NOT_TRUST,
    };
    const config = createRuntime({ workingDir: WORKSPACE_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      OTHER_FOLDER,
      TrustLevel.TRUST_FOLDER,
    );
  });

  it('B5: committing TRUST_FOLDER for an unrelated folder does NOT make the session trusted', async () => {
    let liveTrust = false;
    const setTrustedFolderLive = vi.fn(async (trusted: boolean) => {
      liveTrust = trusted;
    });
    const config = createRuntime({
      workingDir: CWD_PROJECT,
      isTrusted: () => liveTrust,
      setTrustedFolderLive,
    });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      OTHER_FOLDER,
      TrustLevel.TRUST_FOLDER,
    );
    // The session remains untrusted because the live trust is resolved from the
    // working directory, which has no matching rule.
    expect(result.current.effectiveTrust).toBe(false);
  });

  it('B5: committing TRUST_FOLDER on an ANCESTOR of the cwd updates live session trust', async () => {
    let liveTrust = false;
    const setTrustedFolderLive = vi.fn(async (trusted: boolean) => {
      liveTrust = trusted;
    });
    mockedUserConfig.value = {};
    mockedResolvePathTrust.mockImplementation((folderPath: string) => {
      // After committing a rule on the ancestor, resolving the cwd should find it.
      const ancestorRule = mockedUserConfig.value[ANCESTOR_OF_CWD];
      if (
        folderPath === CWD_PROJECT &&
        ancestorRule === TrustLevel.TRUST_FOLDER
      ) {
        return {
          rule: {
            path: ANCESTOR_OF_CWD,
            trustLevel: TrustLevel.TRUST_FOLDER,
          },
          effectivePath: ANCESTOR_OF_CWD,
          trusted: true,
          provenance: 'inherited',
        };
      }
      return undefined;
    });
    const config = createRuntime({
      workingDir: CWD_PROJECT,
      isTrusted: () => liveTrust,
      setTrustedFolderLive,
    });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(ANCESTOR_OF_CWD);
    });

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      ANCESTOR_OF_CWD,
      TrustLevel.TRUST_FOLDER,
    );
    // The live trust is resolved from the cwd, which is now a descendant of the
    // newly-trusted ancestor, so the session becomes trusted.
    expect(result.current.effectiveTrust).toBe(true);
    expect(setTrustedFolderLive).toHaveBeenLastCalledWith(true);
  });

  it('B6: exposes the current rule list refreshed after a successful set', async () => {
    mockedUserConfig.value = {};
    const config = createRuntime({ workingDir: WORKSPACE_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.trustRules).toStrictEqual([]);

    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });

    expect(result.current.trustRules).toStrictEqual([
      { path: WORKSPACE_PROJECT, trustLevel: TrustLevel.TRUST_FOLDER },
    ]);
  });

  it('B6: the rule list is refreshed after a successful removal', async () => {
    mockedUserConfig.value = {
      [WORKSPACE_PROJECT]: TrustLevel.TRUST_FOLDER,
    };
    const config = createRuntime({
      workingDir: WORKSPACE_PROJECT,
      isTrusted: true,
    });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.trustRules).toStrictEqual([
      { path: WORKSPACE_PROJECT, trustLevel: TrustLevel.TRUST_FOLDER },
    ]);

    await act(async () => {
      await result.current.removeTrustRule(WORKSPACE_PROJECT);
    });

    expect(result.current.trustRules).toStrictEqual([]);
  });

  it('B7: removeTrustRule deletes a stale rule whose folder no longer exists on disk', async () => {
    const staleRule = path.resolve('/nonexistent/stale-folder');
    mockedUserConfig.value = {
      [staleRule]: TrustLevel.TRUST_FOLDER,
    };
    mockedDeleteRuleByKey.mockImplementation((ruleKey: string) => {
      delete mockedUserConfig.value[ruleKey];
    });
    const config = createRuntime({
      workingDir: WORKSPACE_PROJECT,
      isTrusted: true,
    });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.trustRules).toContainEqual({
      path: staleRule,
      trustLevel: TrustLevel.TRUST_FOLDER,
    });

    let removalResult:
      | { success: true }
      | { success: false; error: unknown }
      | undefined;
    await act(async () => {
      removalResult = await result.current.removeTrustRule(staleRule);
    });

    expect(removalResult).toMatchObject({ success: true });
    expect(
      result.current.trustRules.find((rule) => rule.path === staleRule),
    ).toBeUndefined();
  });

  it('B7: removeTrustRule reports a failure when deletion throws', async () => {
    mockedUserConfig.value = {
      [WORKSPACE_PROJECT]: TrustLevel.TRUST_FOLDER,
    };
    mockedDeleteRuleByKey.mockReset();
    mockedDeleteRuleByKey.mockImplementation(() => {
      throw new Error('disk error');
    });
    const config = createRuntime({
      workingDir: WORKSPACE_PROJECT,
      isTrusted: true,
    });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    let removalResult:
      | { success: true }
      | { success: false; error: unknown }
      | undefined;
    await act(async () => {
      removalResult = await result.current.removeTrustRule(WORKSPACE_PROJECT);
    });

    expect(removalResult).toMatchObject({
      success: false,
      error: expect.any(Error),
    });
  });

  it('B8: preserves persistence rollback when setValue throws after a targetPath change', async () => {
    mockedSetValue.mockReset();
    mockedSetValue.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const config = createRuntime({ workingDir: WORKSPACE_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    let commitResult:
      | { success: true }
      | {
          success: false;
          phase: 'persistence' | 'live';
          error: unknown;
          rollbackSucceeded: boolean;
        }
      | undefined;
    await act(async () => {
      commitResult = await result.current.commitTrustLevel(
        TrustLevel.TRUST_FOLDER,
      );
    });

    expect(commitResult).toMatchObject({
      success: false,
      phase: 'persistence',
    });
    expect(result.current.committedTrustLevel).toBeUndefined();
    // A failed persistence must leave no trace of the attempted rule, so the
    // store cannot be left partially updated.
    expect(mockedUserConfig.value[OTHER_FOLDER]).toBeUndefined();
    expect(result.current.trustRules).toStrictEqual([]);
  });

  it('B8: preserves live rollback when setTrustedFolderLive throws for an ancestor commit', async () => {
    let liveTrust = false;
    mockedUserConfig.value = {};
    mockedResolvePathTrust.mockImplementation((folderPath: string) => {
      const ancestorRule = mockedUserConfig.value[ANCESTOR_OF_CWD];
      if (
        folderPath === CWD_PROJECT &&
        ancestorRule === TrustLevel.TRUST_FOLDER
      ) {
        return {
          rule: {
            path: ANCESTOR_OF_CWD,
            trustLevel: TrustLevel.TRUST_FOLDER,
          },
          effectivePath: ANCESTOR_OF_CWD,
          trusted: true,
          provenance: 'inherited',
        };
      }
      return undefined;
    });
    const setTrustedFolderLive = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('live update failed');
      })
      .mockImplementation(() => undefined);
    const config = createRuntime({
      workingDir: CWD_PROJECT,
      isTrusted: () => liveTrust,
      setTrustedFolderLive: async (trusted: boolean) => {
        await setTrustedFolderLive(trusted);
        liveTrust = trusted;
      },
    });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(ANCESTOR_OF_CWD);
    });

    let firstResult:
      | { success: true }
      | {
          success: false;
          phase: 'persistence' | 'live';
          error: unknown;
          rollbackSucceeded: boolean;
        }
      | undefined;
    await act(async () => {
      firstResult = await result.current.commitTrustLevel(
        TrustLevel.TRUST_FOLDER,
      );
    });

    expect(firstResult).toMatchObject({ success: false, phase: 'live' });
    expect(mockedRestoreSnapshot).toHaveBeenCalledOnce();
    expect(result.current.committedTrustLevel).toBeUndefined();

    // Retry succeeds.
    await act(async () => {
      await result.current.commitTrustLevel(TrustLevel.TRUST_FOLDER);
    });
    expect(result.current.committedTrustLevel).toBe(TrustLevel.TRUST_FOLDER);
  });

  it('B9: isTargetCwd reflects whether the active target is the working directory', () => {
    const config = createRuntime({ workingDir: CWD_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.isTargetCwd).toBe(true);

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    expect(result.current.isTargetCwd).toBe(false);
  });

  it('B9: isParentTrusted is undefined-equivalent (false) for a non-cwd target with no inherited rule', () => {
    mockedIdeTrust.value = undefined;
    const config = createRuntime({ workingDir: CWD_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    // isIdeTrusted describes the cwd workspace; for a non-cwd target the
    // effectiveLocalTrustLevel/isParentTrusted derive from the target only.
    expect(result.current.isParentTrusted).toBe(false);
  });

  it('B9: IDE trust does not govern a non-cwd target path', () => {
    mockedIdeTrust.value = true;
    const config = createRuntime({ workingDir: CWD_PROJECT, isTrusted: true });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    expect(result.current.isIdeTrusted).toBe(true);

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    // The IDE trusts its own workspace, not an arbitrary unrelated folder.
    expect(result.current.isIdeTrusted).toBeUndefined();
  });

  it('B9: IDE trust still governs once the target returns to the working directory', () => {
    mockedIdeTrust.value = false;
    const config = createRuntime({ workingDir: CWD_PROJECT });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });
    expect(result.current.isIdeTrusted).toBeUndefined();

    act(() => {
      result.current.setTargetPath(CWD_PROJECT);
    });
    expect(result.current.isIdeTrusted).toBe(false);
  });

  it('B9: a non-cwd target reports inherited provenance from its own rule even while IDE trust governs the cwd', () => {
    mockedIdeTrust.value = true;
    mockedResolvePathTrust.mockImplementation((folderPath: string) =>
      folderPath === OTHER_FOLDER
        ? {
            rule: {
              path: path.dirname(OTHER_FOLDER),
              trustLevel: TrustLevel.TRUST_FOLDER,
            },
            effectivePath: path.dirname(OTHER_FOLDER),
            trusted: true,
            provenance: 'inherited' as const,
          }
        : undefined,
    );
    const config = createRuntime({ workingDir: CWD_PROJECT, isTrusted: true });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    expect(result.current.isParentTrusted).toBe(true);
  });

  it('B9: the displayed trust state of a non-cwd target comes from its own rule, not the live session', () => {
    mockedResolvePathTrust.mockImplementation((folderPath: string) =>
      folderPath === OTHER_FOLDER
        ? {
            rule: {
              path: OTHER_FOLDER,
              trustLevel: TrustLevel.DO_NOT_TRUST,
            },
            effectivePath: OTHER_FOLDER,
            trusted: false,
            provenance: 'direct' as const,
          }
        : undefined,
    );
    // The live session (cwd) is trusted...
    const config = createRuntime({ workingDir: CWD_PROJECT, isTrusted: true });
    const { result } = renderHook(() => usePermissionsModifyTrust(config));

    act(() => {
      result.current.setTargetPath(OTHER_FOLDER);
    });

    // ...but the untrusted target folder must not be shown as trusted.
    expect(result.current.effectiveLocalTrustLevel).toBe(
      TrustLevel.DO_NOT_TRUST,
    );
    expect(result.current.effectiveTrust).toBe(false);
  });
});
