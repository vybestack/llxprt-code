/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useMemo } from 'react';
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

const emptyIdeState: Pick<CliUiRuntime, 'getIdeClient'> = {
  getIdeClient: () => undefined,
};

export interface UsePermissionsModifyTrustReturn {
  /** Current trust level for the working directory */
  currentTrustLevel: TrustLevel | undefined;
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

/**
 * Hook that manages folder trust settings for the permissions dialog.
 * Handles current trust level state, pending changes, inherited trust detection,
 * and live Config updates via setTrustedFolderLive.
 */
export function usePermissionsModifyTrust(
  config?: CliUiRuntime,
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

      setPendingTrustLevel(nextLevel);
      try {
        trustedFolders.setValue(normalizedCwd, nextLevel);
      } catch (error) {
        return { success: false, phase: 'persistence', error };
      }
      setCommittedLevel(nextLevel);

      try {
        if (config) {
          config.setTrustedFolderLive(
            resolveLocalWorkspaceTrust(
              { folderTrust: config.getFolderTrust() },
              trustedFolders,
              normalizedCwd,
            ) ?? false,
          );
          setEffectiveTrust(config.isTrustedFolder());
        } else {
          setEffectiveTrust(nextLevel !== TrustLevel.DO_NOT_TRUST);
        }
      } catch (error) {
        return { success: false, phase: 'live', error };
      }
      return { success: true };
    },
    [pendingTrustLevel, trustedFolders, normalizedCwd, config],
  );

  const trustChanged = committedLevel !== undefined;

  return {
    currentTrustLevel,
    pendingTrustLevel,
    setPendingTrustLevel,
    commitTrustLevel,
    effectiveLocalTrustLevel,
    isIdeTrusted,
    isParentTrusted,
    trustChanged,
    committedTrustLevel: committedLevel,
    effectiveTrust,
    workingDirectory: cwd,
    parentFolderName,
    trustedFolders,
  };
}
