/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import * as path from 'node:path';
import {
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  type LoadedTrustedFolders,
  TrustLevel,
} from '../../config/trustedFolders.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { useIdeTrustListener } from './useIdeTrustListener.js';
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

export interface UsePermissionsModifyTrustReturn {
  /** Pending trust level change (before commit) */
  pendingTrustLevel: TrustLevel | undefined;
  /** Set a pending trust level change */
  setPendingTrustLevel: (level: TrustLevel) => void;
  /** Commit the pending trust level change */
  commitTrustLevel: (
    level?: TrustLevel,
  ) =>
    | { success: true }
    | { success: false; phase: 'persistence' | 'live'; error: unknown };
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
  folderPath: string,
  hadSavedRule: boolean,
  previousSavedLevel: TrustLevel,
): void {
  if (hadSavedRule) {
    trustedFolders.setValue(folderPath, previousSavedLevel);
  } else {
    trustedFolders.deleteValue(folderPath);
  }
}

function applyLiveTrustLevel(
  config: PermissionsTrustRuntime | undefined,
  trustedFolders: LoadedTrustedFolders,
  folderPath: string,
  nextLevel: TrustLevel,
): boolean {
  if (config === undefined) {
    return nextLevel !== TrustLevel.DO_NOT_TRUST;
  }
  config.setTrustedFolderLive(
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
  | { success: false; phase: 'persistence' | 'live'; error: unknown };

function commitSavedTrustLevel(
  config: PermissionsTrustRuntime | undefined,
  trustedFolders: LoadedTrustedFolders,
  folderPath: string,
  nextLevel: TrustLevel,
): { result: TrustCommitResult; effectiveTrust?: boolean } {
  const hadSavedRule = Object.hasOwn(trustedFolders.user.config, folderPath);
  const previousSavedLevel = trustedFolders.user.config[folderPath];
  try {
    trustedFolders.setValue(folderPath, nextLevel);
  } catch (error) {
    return { result: { success: false, phase: 'persistence', error } };
  }
  try {
    return {
      result: { success: true },
      effectiveTrust: applyLiveTrustLevel(
        config,
        trustedFolders,
        folderPath,
        nextLevel,
      ),
    };
  } catch (error) {
    try {
      restoreSavedTrustLevel(
        trustedFolders,
        folderPath,
        hadSavedRule,
        previousSavedLevel,
      );
    } catch (rollbackError) {
      return {
        result: {
          success: false,
          phase: 'live',
          error: new AggregateError(
            [error, rollbackError],
            'Live trust update and saved-state rollback both failed',
          ),
        },
      };
    }
    return { result: { success: false, phase: 'live', error } };
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
  const cwd = config?.getWorkingDir() ?? process.cwd();
  const normalizedCwd = path.resolve(cwd);
  const parentFolderName = path.basename(path.dirname(normalizedCwd));
  const trustedFolders = useMemo(() => loadTrustedFolders(), []);
  const winningRule = useMemo(
    () => trustedFolders.resolvePathTrust(normalizedCwd),
    [trustedFolders, normalizedCwd],
  );
  const currentTrustLevel = trustedFolders.user.config[normalizedCwd];
  const effectiveLocalTrustLevel = winningRule?.rule.trustLevel;
  const { isIdeTrusted } = useIdeTrustListener(config ?? emptyIdeState);
  const isParentTrusted = winningRule?.provenance === 'inherited';

  const [pendingTrustLevel, setPendingTrustLevel] = useState<
    TrustLevel | undefined
  >(currentTrustLevel);

  const [committedLevel, setCommittedLevel] = useState<TrustLevel | undefined>(
    undefined,
  );
  const [effectiveTrust, setEffectiveTrust] = useState<boolean | undefined>(
    config?.isTrustedFolder() ?? winningRule?.trusted,
  );

  useEffect(() => {
    const resolvedRule = trustedFolders.resolvePathTrust(normalizedCwd);
    setPendingTrustLevel(trustedFolders.user.config[normalizedCwd]);
    setCommittedLevel(undefined);
    setEffectiveTrust(config?.isTrustedFolder() ?? resolvedRule?.trusted);
  }, [config, normalizedCwd, trustedFolders]);

  const commitTrustLevel = useCallback(
    (
      level?: TrustLevel,
    ):
      | { success: true }
      | { success: false; phase: 'persistence' | 'live'; error: unknown } => {
      const nextLevel = level ?? pendingTrustLevel;
      if (nextLevel === undefined) {
        return { success: true };
      }

      const commit = commitSavedTrustLevel(
        config,
        trustedFolders,
        normalizedCwd,
        nextLevel,
      );
      if (!commit.result.success) {
        return commit.result;
      }
      setEffectiveTrust(commit.effectiveTrust);
      setPendingTrustLevel(nextLevel);
      setCommittedLevel(nextLevel);
      return { success: true };
    },
    [pendingTrustLevel, trustedFolders, normalizedCwd, config],
  );

  const trustChanged = committedLevel !== undefined;

  return {
    pendingTrustLevel,
    setPendingTrustLevel,
    commitTrustLevel,
    effectiveLocalTrustLevel,
    isIdeTrusted,
    isParentTrusted,
    trustChanged,
    committedTrustLevel: committedLevel,
    effectiveTrust,
    workingDirectory: normalizedCwd,
    parentFolderName,
    trustedFolders,
  };
}
