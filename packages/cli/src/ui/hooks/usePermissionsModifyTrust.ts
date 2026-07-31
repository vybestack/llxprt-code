/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as path from 'node:path';
import type React from 'react';
import {
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  type LoadedTrustedFolders,
  TrustLevel,
  type ResolvedTrustRule,
  type TrustRule,
  type TrustedFolderSnapshot,
} from '../../config/trustedFolders.js';
import { normalizeTrustPathInput } from '../../config/trustPaths.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useIdeTrustListener } from './useIdeTrustListener.js';
import { combineTrustUpdateFailure } from '../trustDialogHelpers.js';
import process from 'node:process';

export type PermissionsTrustRuntime = Pick<
  CliUiRuntime,
  | 'getWorkingDir'
  | 'getFolderTrust'
  | 'getIdeClient'
  | 'isTrustedFolder'
  | 'setTrustedFolderLive'
>;

const emptyIdeState: Pick<PermissionsTrustRuntime, 'getIdeClient'> = {
  getIdeClient: () => undefined,
};

function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

export interface UsePermissionsModifyTrustReturn {
  /** Pending trust level change (before commit) */
  pendingTrustLevel: TrustLevel | undefined;
  /** Set a pending trust level change */
  setPendingTrustLevel: (level: TrustLevel) => void;
  /** Commit the pending trust level change */
  commitTrustLevel: (level?: TrustLevel) => Promise<
    | { success: true }
    | {
        success: false;
        phase: 'persistence' | 'live';
        error: unknown;
        rollbackSucceeded: boolean;
      }
  >;
  /** Effective local trust level, including inherited rules */
  effectiveLocalTrustLevel: TrustLevel | undefined;
  /** Whether the workspace is trusted through IDE */
  isIdeTrusted: boolean | undefined;
  /** Whether the winning local rule is inherited */
  isParentTrusted: boolean;
  /** Whether a trust change was committed */
  trustChanged: boolean;
  /** The local trust level saved during this dialog session */
  committedTrustLevel: TrustLevel | undefined;
  /** The live effective trust state after the change */
  effectiveTrust: boolean | undefined;
  /** The current working directory */
  workingDirectory: string;
  /** The parent folder name */
  parentFolderName: string;
  /** The loaded trusted folders configuration */
  trustedFolders: LoadedTrustedFolders;
  /** The folder path currently targeted for trust changes */
  targetPath: string;
  /** Set the target folder path; input is normalized via the shared helper */
  setTargetPath: (rawPath: string) => void;
  /** Whether the active target path is the working directory */
  isTargetCwd: boolean;
  /** The current trust rules (path + level), refreshed after every mutation */
  trustRules: readonly TrustRule[];
  /** Remove a stored trust rule by its exact key (works for stale paths) */
  removeTrustRule: (
    ruleKey: string,
  ) => Promise<{ success: true } | { success: false; error: unknown }>;
}

function restoreSavedTrustLevel(
  trustedFolders: LoadedTrustedFolders,
  snapshot: TrustedFolderSnapshot,
): void {
  trustedFolders.restoreSnapshot(snapshot);
}

async function applyLiveTrustLevel(
  config: PermissionsTrustRuntime,
  trustedFolders: LoadedTrustedFolders,
  folderPath: string,
): Promise<boolean> {
  await config.setTrustedFolderLive(
    resolveLocalWorkspaceTrust(
      { folderTrust: config.getFolderTrust() },
      trustedFolders,
      folderPath,
    ) ?? false,
  );
  return config.isTrustedFolder();
}

type TrustCommitResult =
  | { success: true }
  | {
      success: false;
      phase: 'persistence' | 'live';
      error: unknown;
      rollbackSucceeded: boolean;
    };

/**
 * Persists a trust rule for `persistPath` while always resolving the live
 * session trust from `liveTrustPath` (the working directory). This split
 * ensures that committing a rule for an arbitrary folder only affects the
 * live session when that folder is an ancestor of the working directory.
 */
async function commitSavedTrustLevel(
  config: PermissionsTrustRuntime | undefined,
  trustedFolders: LoadedTrustedFolders,
  persistPath: string,
  liveTrustPath: string,
  nextLevel: TrustLevel,
): Promise<{ result: TrustCommitResult; effectiveTrust?: boolean }> {
  let savedSnapshot: TrustedFolderSnapshot;
  try {
    savedSnapshot = trustedFolders.snapshotValue(persistPath);
  } catch (error) {
    return {
      result: {
        success: false,
        phase: 'persistence',
        error,
        rollbackSucceeded: true,
      },
    };
  }
  const previousLiveTrust = config?.isTrustedFolder() ?? false;
  try {
    trustedFolders.setValue(persistPath, nextLevel);
  } catch (error) {
    return {
      result: {
        success: false,
        phase: 'persistence',
        error,
        rollbackSucceeded: true,
      },
    };
  }
  if (config === undefined) {
    return {
      result: { success: true },
      effectiveTrust: nextLevel !== TrustLevel.DO_NOT_TRUST,
    };
  }
  try {
    return {
      result: { success: true },
      effectiveTrust: await applyLiveTrustLevel(
        config,
        trustedFolders,
        liveTrustPath,
      ),
    };
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    try {
      restoreSavedTrustLevel(trustedFolders, savedSnapshot);
    } catch (rollbackError) {
      rollbackFailures.push(rollbackError);
    }
    try {
      await config.setTrustedFolderLive(previousLiveTrust);
    } catch (rollbackError) {
      rollbackFailures.push(rollbackError);
    }
    const failure = combineTrustUpdateFailure(
      error,
      rollbackFailures,
      'Live trust update and rollback failed',
    );
    return {
      result: {
        success: false,
        phase: 'live',
        error: failure.error,
        rollbackSucceeded: failure.rollbackSucceeded,
      },
    };
  }
}

type CommitSetter = (
  effectiveTrust: boolean | undefined,
  nextLevel: TrustLevel,
) => void;

/**
 * Builds the serialized commit callback. State setters are passed in to keep
 * the factory pure and keep the main hook body under its complexity budget.
 */
function useCommitCallback(
  pendingTrustLevel: TrustLevel | undefined,
  trustedFolders: LoadedTrustedFolders,
  targetPath: string,
  workingDirectory: string,
  config: PermissionsTrustRuntime | undefined,
  mountedRef: React.MutableRefObject<boolean>,
  currentTargetPathRef: React.MutableRefObject<string>,
  commitQueueRef: React.MutableRefObject<Promise<void>>,
  applyCommitSuccess: CommitSetter,
): (level?: TrustLevel) => Promise<TrustCommitResult> {
  return useCallback(
    (level?: TrustLevel): Promise<TrustCommitResult> => {
      const nextLevel = level ?? pendingTrustLevel;
      if (nextLevel === undefined) {
        return Promise.resolve({ success: true });
      }
      const runCommit = async (): Promise<TrustCommitResult> => {
        const commit = await commitSavedTrustLevel(
          config,
          trustedFolders,
          targetPath,
          workingDirectory,
          nextLevel,
        );
        if (!commit.result.success) {
          return commit.result;
        }
        if (mountedRef.current && currentTargetPathRef.current === targetPath) {
          applyCommitSuccess(commit.effectiveTrust, nextLevel);
        }
        return { success: true };
      };
      const commit = commitQueueRef.current.then(runCommit, runCommit);
      commitQueueRef.current = commit.then(
        () => undefined,
        () => undefined,
      );
      return commit;
    },
    [
      pendingTrustLevel,
      trustedFolders,
      targetPath,
      workingDirectory,
      config,
      mountedRef,
      currentTargetPathRef,
      commitQueueRef,
      applyCommitSuccess,
    ],
  );
}

/**
 * Builds the rule-removal callback (literal-key deletion so stale paths work).
 */
function useRemoveCallback(
  trustedFolders: LoadedTrustedFolders,
  mountedRef: React.MutableRefObject<boolean>,
  currentTargetPathRef: React.MutableRefObject<string>,
  refreshRules: () => void,
  setPendingTrustLevel: (level: TrustLevel | undefined) => void,
): (
  ruleKey: string,
) => Promise<{ success: true } | { success: false; error: unknown }> {
  return useCallback(
    async (
      ruleKey: string,
    ): Promise<{ success: true } | { success: false; error: unknown }> => {
      try {
        trustedFolders.deleteRuleByKey(ruleKey);
        if (mountedRef.current) {
          refreshRules();
          if (ruleKey === currentTargetPathRef.current) {
            setPendingTrustLevel(trustedFolders.getValue(ruleKey));
          }
        }
        return { success: true };
      } catch (error) {
        return { success: false, error };
      }
    },
    [
      trustedFolders,
      mountedRef,
      currentTargetPathRef,
      refreshRules,
      setPendingTrustLevel,
    ],
  );
}

interface TargetPathState {
  targetPath: string;
  setTargetPath: (rawPath: string) => void;
  isTargetCwd: boolean;
}

/**
 * Manages the target folder path state, resetting to the cwd when the working
 * directory changes and normalizing user input via the shared helper.
 */
function useTargetPath(workingDirectory: string): TargetPathState {
  const [targetPath, setTargetPathState] = useState(workingDirectory);

  useEffect(() => {
    setTargetPathState(workingDirectory);
  }, [workingDirectory]);

  const setTargetPath = useCallback(
    (rawPath: string): void => {
      const result = normalizeTrustPathInput(rawPath, workingDirectory);
      if (result.ok) {
        setTargetPathState(result.normalizedPath);
      }
    },
    [workingDirectory],
  );

  return {
    targetPath,
    setTargetPath,
    isTargetCwd: targetPath === workingDirectory,
  };
}

interface DerivedTrustState {
  winningRule: ResolvedTrustRule | undefined;
  currentEffectiveTrust: boolean | undefined;
  isIdeTrusted: boolean | undefined;
  isParentTrusted: boolean;
}

/**
 * Derives the winning trust rule, effective trust, IDE trust, and parent-trust
 * provenance from the current target path.
 *
 * IDE trust and the live session trust describe the IDE's workspace (the
 * working directory) only. When the target is some other folder, both are
 * ignored and the state is derived purely from that folder's own winning rule,
 * so an unrelated folder is never displayed as trusted just because the current
 * session is.
 */
function useDerivedTrustState(
  config: PermissionsTrustRuntime | undefined,
  trustedFolders: LoadedTrustedFolders,
  targetPath: string,
  isTargetCwd: boolean,
): DerivedTrustState {
  const winningRule = trustedFolders.resolvePathTrust(targetPath);
  const { isIdeTrusted: workspaceIdeTrust } = useIdeTrustListener(
    config ?? emptyIdeState,
  );
  const isIdeTrusted = isTargetCwd ? workspaceIdeTrust : undefined;
  const currentEffectiveTrust = isTargetCwd
    ? (config?.isTrustedFolder() ?? winningRule?.trusted)
    : winningRule?.trusted;
  const isParentTrusted =
    isIdeTrusted === undefined && winningRule?.provenance === 'inherited';
  return { winningRule, currentEffectiveTrust, isIdeTrusted, isParentTrusted };
}

interface TrustSessionState {
  pendingTrustLevel: TrustLevel | undefined;
  setPendingTrustLevel: React.Dispatch<
    React.SetStateAction<TrustLevel | undefined>
  >;
  committedLevel: TrustLevel | undefined;
  effectiveTrust: boolean | undefined;
  trustRules: readonly TrustRule[];
  refreshRules: () => void;
  applyCommitSuccess: CommitSetter;
}

/**
 * Mutable dialog-session state: the pending/committed level for the active
 * target path, the live effective trust, and the rule list that must be
 * refreshed after every mutation.
 */
function useTrustSessionState(
  trustedFolders: LoadedTrustedFolders,
  targetPath: string,
  currentEffectiveTrust: boolean | undefined,
): TrustSessionState {
  const [pendingTrustLevel, setPendingTrustLevel] = useState<
    TrustLevel | undefined
  >(() => trustedFolders.getValue(targetPath));
  const [committedLevel, setCommittedLevel] = useState<TrustLevel>();
  const [effectiveTrust, setEffectiveTrust] = useState(currentEffectiveTrust);
  const [trustRules, setTrustRules] = useState<readonly TrustRule[]>(
    () => trustedFolders.rules,
  );
  useEffect(() => {
    setPendingTrustLevel(trustedFolders.getValue(targetPath));
    setCommittedLevel(undefined);
  }, [targetPath, trustedFolders]);
  useEffect(
    () => setEffectiveTrust(currentEffectiveTrust),
    [currentEffectiveTrust],
  );
  const refreshRules = useCallback(
    () => setTrustRules(trustedFolders.rules),
    [trustedFolders],
  );
  const applyCommitSuccess = useCallback(
    (nextEffectiveTrust: boolean | undefined, nextLevel: TrustLevel): void => {
      setEffectiveTrust(nextEffectiveTrust);
      setPendingTrustLevel(nextLevel);
      setCommittedLevel(nextLevel);
      setTrustRules(trustedFolders.rules);
    },
    [trustedFolders],
  );
  return {
    pendingTrustLevel,
    setPendingTrustLevel,
    committedLevel,
    effectiveTrust,
    trustRules,
    refreshRules,
    applyCommitSuccess,
  };
}

/**
 * Hook that manages folder trust settings for the permissions dialog.
 * Handles current trust level state, pending changes, inherited trust detection,
 * and live Config updates via setTrustedFolderLive. The `targetPath` determines
 * which folder a trust change applies to; live session trust is always resolved
 * from the working directory.
 */
export function usePermissionsModifyTrust(
  config?: PermissionsTrustRuntime,
): UsePermissionsModifyTrustReturn {
  const normalizedCwd = path.resolve(config?.getWorkingDir() ?? process.cwd());
  const trustedFolders = useMemo(() => loadTrustedFolders(), []);
  const { targetPath, setTargetPath, isTargetCwd } =
    useTargetPath(normalizedCwd);
  const { winningRule, currentEffectiveTrust, isIdeTrusted, isParentTrusted } =
    useDerivedTrustState(config, trustedFolders, targetPath, isTargetCwd);
  const {
    pendingTrustLevel,
    setPendingTrustLevel,
    committedLevel,
    effectiveTrust,
    trustRules,
    refreshRules,
    applyCommitSuccess,
  } = useTrustSessionState(trustedFolders, targetPath, currentEffectiveTrust);
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useMountedRef();
  const currentTargetPathRef = useRef(targetPath);
  currentTargetPathRef.current = targetPath;
  const commitTrustLevel = useCommitCallback(
    pendingTrustLevel,
    trustedFolders,
    targetPath,
    normalizedCwd,
    config,
    mountedRef,
    currentTargetPathRef,
    commitQueueRef,
    applyCommitSuccess,
  );
  const removeTrustRule = useRemoveCallback(
    trustedFolders,
    mountedRef,
    currentTargetPathRef,
    refreshRules,
    setPendingTrustLevel,
  );
  const trustChanged = committedLevel !== undefined;
  return {
    pendingTrustLevel,
    setPendingTrustLevel,
    commitTrustLevel,
    effectiveLocalTrustLevel: winningRule?.rule.trustLevel,
    isIdeTrusted,
    isParentTrusted,
    trustChanged,
    committedTrustLevel: committedLevel,
    effectiveTrust,
    workingDirectory: normalizedCwd,
    parentFolderName: path.basename(path.dirname(targetPath)),
    trustedFolders,
    targetPath,
    setTargetPath,
    isTargetCwd,
    trustRules,
    removeTrustRule,
  };
}
