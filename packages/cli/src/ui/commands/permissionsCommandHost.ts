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
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { MessageActionReturn } from './types.js';
export function bindPermissionCommit(
  config: Pick<
    CliUiRuntime,
    | 'isTrustedFolder'
    | 'getWorkingDir'
    | 'setTrustedFolderLive'
    | 'getFolderTrust'
  > | null,
): (
  trustLevel: TrustLevel,
  targetPath: string,
) => Promise<MessageActionReturn> {
  return async (trustLevel, targetPath) => {
    let trustedFolders: ReturnType<typeof loadTrustedFolders> | undefined;
    let savedSnapshot:
      | ReturnType<ReturnType<typeof loadTrustedFolders>['snapshotValue']>
      | undefined;
    const previousLiveTrust = config?.isTrustedFolder() ?? false;
    let failedPhase: 'persistence' | 'live' = 'persistence';
    try {
      trustedFolders = loadTrustedFolders();
      savedSnapshot = trustedFolders.snapshotValue(targetPath);
      trustedFolders.setValue(targetPath, trustLevel);
      if (config) {
        failedPhase = 'live';
        const cwd = config.getWorkingDir();
        await config.setTrustedFolderLive(
          resolveLocalWorkspaceTrust(
            { folderTrust: config.getFolderTrust() },
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
      if (config && failedPhase === 'live') {
        try {
          await config.setTrustedFolderLive(previousLiveTrust);
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
