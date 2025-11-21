/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useMemo } from 'react';
import * as path from 'node:path';
import {
  loadTrustedFolders,
  TrustLevel,
  LoadedTrustedFolders,
} from '../../config/trustedFolders.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { getIdeTrust } from '@vybestack/llxprt-code-core';

export interface UsePermissionsModifyTrustReturn {
  /** Current trust level for the working directory */
  currentTrustLevel: TrustLevel | undefined;
  /** Pending trust level change (before commit) */
  pendingTrustLevel: TrustLevel | undefined;
  /** Set a pending trust level change */
  setPendingTrustLevel: (level: TrustLevel) => void;
  /** Commit the pending trust level change */
  commitTrustLevel: (level?: TrustLevel) => void;
  /** Whether the workspace is trusted through IDE */
  isIdeTrusted: boolean;
  /** Whether the workspace is trusted through parent folder */
  isParentTrusted: boolean;
  /** Whether a restart is required after committing */
  requiresRestart: boolean;
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
 * and restart requirement detection.
 */
export function usePermissionsModifyTrust(): UsePermissionsModifyTrustReturn {
  const settings = useSettings();
  const cwd = process.cwd();
  const parentFolderName = path.basename(path.dirname(cwd));

  const trustedFolders = useMemo(() => loadTrustedFolders(), []);

  // Determine current trust level for the working directory
  const currentTrustLevel = useMemo((): TrustLevel | undefined => {
    // Find exact match for current directory
    const rule = trustedFolders.rules.find(
      (r) => path.normalize(r.path) === path.normalize(cwd),
    );
    return rule?.trustLevel;
  }, [trustedFolders, cwd]);

  // Check if trusted through IDE
  const isIdeTrusted = useMemo(() => {
    const ideTrust = getIdeTrust();
    return ideTrust === true;
  }, []);

  // Check if trusted through parent folder
  const isParentTrusted = useMemo(() => {
    if (isIdeTrusted) return false;

    // Check if any parent rule would trust this directory
    for (const rule of trustedFolders.rules) {
      if (rule.trustLevel === TrustLevel.TRUST_PARENT) {
        const parentPath = path.dirname(rule.path);
        if (path.normalize(cwd).startsWith(path.normalize(parentPath))) {
          return true;
        }
      }
      if (rule.trustLevel === TrustLevel.TRUST_FOLDER) {
        const normalizedRulePath = path.normalize(rule.path);
        const normalizedCwd = path.normalize(cwd);
        if (
          normalizedCwd.startsWith(normalizedRulePath) &&
          normalizedCwd !== normalizedRulePath
        ) {
          return true;
        }
      }
    }
    return false;
  }, [trustedFolders, cwd, isIdeTrusted]);

  const [pendingTrustLevel, setPendingTrustLevel] = useState<
    TrustLevel | undefined
  >(currentTrustLevel);

  const [hasCommitted, setHasCommitted] = useState(false);

  const commitTrustLevel = useCallback(
    (level?: TrustLevel) => {
      const nextLevel = level ?? pendingTrustLevel;
      if (!nextLevel) {
        return;
      }

      setPendingTrustLevel(nextLevel);
      trustedFolders.setValue(cwd, nextLevel);
      setHasCommitted(true);
    },
    [pendingTrustLevel, trustedFolders, cwd],
  );

  // Determine if restart is required after committing
  const requiresRestart = useMemo(() => {
    if (!hasCommitted) return false;

    // Check if folder trust feature is enabled
    const folderTrustEnabled = settings.merged.folderTrust ?? false;
    if (!folderTrustEnabled) return false;

    // A restart is required if we changed the trust level
    return pendingTrustLevel !== currentTrustLevel;
  }, [hasCommitted, pendingTrustLevel, currentTrustLevel, settings]);

  return {
    currentTrustLevel,
    pendingTrustLevel,
    setPendingTrustLevel,
    commitTrustLevel,
    isIdeTrusted,
    isParentTrusted,
    requiresRestart,
    workingDirectory: cwd,
    parentFolderName,
    trustedFolders,
  };
}
