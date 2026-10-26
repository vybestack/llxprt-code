/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  type TrustLevel,
} from '../../config/trustedFolders.js';
import {
  combineTrustUpdateFailure,
  getTrustCommitErrorMessage,
} from '../trustDialogHelpers.js';
import type { MessageActionReturn } from './types.js';

/**
 * The workspace-trust state the /permissions trust commit reads and writes.
 */
export interface PermissionsTrustRuntime {
  isTrustedFolder(): boolean;
  getWorkingDir(): string;
  setTrustedFolderLive(trusted: boolean): Promise<void>;
  getFolderTrust(): boolean;
}

export function bindPermissionCommit(
  runtime: PermissionsTrustRuntime | null,
): (
  trustLevel: TrustLevel,
  targetPath: string,
) => Promise<MessageActionReturn> {
  return async (trustLevel, targetPath) => {
    let trustedFolders: ReturnType<typeof loadTrustedFolders> | undefined;
    let savedSnapshot:
      | ReturnType<ReturnType<typeof loadTrustedFolders>['snapshotValue']>
      | undefined;
    const previousLiveTrust = runtime?.isTrustedFolder() ?? false;
    let failedPhase: 'persistence' | 'live' = 'persistence';
    try {
      trustedFolders = loadTrustedFolders();
      savedSnapshot = trustedFolders.snapshotValue(targetPath);
      trustedFolders.setValue(targetPath, trustLevel);
      if (runtime) {
        failedPhase = 'live';
        const cwd = runtime.getWorkingDir();
        await runtime.setTrustedFolderLive(
          resolveLocalWorkspaceTrust(
            { folderTrust: runtime.getFolderTrust() },
            trustedFolders,
            cwd,
          ) ?? false,
        );
      }
      return {
        type: 'message',
        messageType: 'info',
        content: `Trust level set to ${trustLevel} for: ${targetPath}`,
      };
    } catch (error) {
      const rollbackFailures: unknown[] = [];
      if (trustedFolders !== undefined && savedSnapshot !== undefined) {
        try {
          trustedFolders.restoreSnapshot(savedSnapshot);
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError);
        }
      }
      if (runtime && failedPhase === 'live') {
        try {
          await runtime.setTrustedFolderLive(previousLiveTrust);
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError);
        }
      }
      const failure = combineTrustUpdateFailure(
        error,
        rollbackFailures,
        'Trust update and rollback failed',
      );
      return {
        type: 'message',
        messageType: 'error',
        content: getTrustCommitErrorMessage(
          failedPhase,
          failure.error,
          failure.rollbackSucceeded,
        ),
      };
    }
  };
}
