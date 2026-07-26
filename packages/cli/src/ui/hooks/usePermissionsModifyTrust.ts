/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as path from 'node:path';
import {
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  type LoadedTrustedFolders,
  TrustLevel,
  type TrustedFolderSnapshot,
} from '../../config/trustedFolders.js';
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

async function commitSavedTrustLevel(
  config: PermissionsTrustRuntime | undefined,
  trustedFolders: LoadedTrustedFolders,
  folderPath: string,
  nextLevel: TrustLevel,
): Promise<{ result: TrustCommitResult; effectiveTrust?: boolean }> {
  let savedSnapshot: TrustedFolderSnapshot;
  try {
    savedSnapshot = trustedFolders.snapshotValue(folderPath);
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
    trustedFolders.setValue(folderPath, nextLevel);
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
        folderPath,
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

/**
 * Hook that manages folder trust settings for the permissions dialog.
 * Handles current trust level state, pending changes, inherited trust detection,
 * and live Config updates via setTrustedFolderLive.
 */
export function usePermissionsModifyTrust(
  config?: PermissionsTrustRuntime,
): UsePermissionsModifyTrustReturn {
  const normalizedCwd = path.resolve(config?.getWorkingDir() ?? process.cwd());
  const trustedFolders = useMemo(() => loadTrustedFolders(), []);
  const winningRule = trustedFolders.resolvePathTrust(normalizedCwd);
  const currentEffectiveTrust =
    config?.isTrustedFolder() ?? winningRule?.trusted;
  const { isIdeTrusted } = useIdeTrustListener(config ?? emptyIdeState);
  const isParentTrusted =
    isIdeTrusted === undefined && winningRule?.provenance === 'inherited';
  const [pendingTrustLevel, setPendingTrustLevel] = useState<
    TrustLevel | undefined
  >(() => trustedFolders.getValue(normalizedCwd));
  const [committedLevel, setCommittedLevel] = useState<TrustLevel>();
  const [effectiveTrust, setEffectiveTrust] = useState(currentEffectiveTrust);
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useMountedRef();
  const currentWorkingDirectoryRef = useRef(normalizedCwd);
  currentWorkingDirectoryRef.current = normalizedCwd;
  useEffect(() => {
    setPendingTrustLevel(trustedFolders.getValue(normalizedCwd));
    setCommittedLevel(undefined);
  }, [normalizedCwd, trustedFolders]);
  useEffect(
    () => setEffectiveTrust(currentEffectiveTrust),
    [currentEffectiveTrust],
  );
  const commitTrustLevel = useCallback(
    (level?: TrustLevel): Promise<TrustCommitResult> => {
      const nextLevel = level ?? pendingTrustLevel;
      if (nextLevel === undefined) {
        return Promise.resolve({ success: true });
      }

      const runCommit = async (): Promise<TrustCommitResult> => {
        const commit = await commitSavedTrustLevel(
          config,
          trustedFolders,
          normalizedCwd,
          nextLevel,
        );
        if (!commit.result.success) {
          return commit.result;
        }
        if (
          mountedRef.current &&
          currentWorkingDirectoryRef.current === normalizedCwd
        ) {
          setEffectiveTrust(commit.effectiveTrust);
          setPendingTrustLevel(nextLevel);
          setCommittedLevel(nextLevel);
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
    [pendingTrustLevel, trustedFolders, normalizedCwd, config, mountedRef],
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
    parentFolderName: path.basename(path.dirname(normalizedCwd)),
    trustedFolders,
  };
}
