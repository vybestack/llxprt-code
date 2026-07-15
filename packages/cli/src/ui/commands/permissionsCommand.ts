/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as process from 'node:process';
import type {
  OpenDialogActionReturn,
  SlashCommand,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  TrustLevel,
} from '../../config/trustedFolders.js';
import {
  combineTrustUpdateFailure,
  getTrustCommitErrorMessage,
} from '../trustDialogHelpers.js';

const VALID_TRUST_LEVELS = [
  TrustLevel.TRUST_FOLDER,
  TrustLevel.TRUST_PARENT,
  TrustLevel.DO_NOT_TRUST,
] as const;

/**
 * Parse arguments for the permissions command.
 * Expected format: `<TRUST_LEVEL> <path>`
 */
function parsePermissionsArgs(
  args: string,
  workingDirectory: string,
): { trustLevel: TrustLevel; targetPath: string } | { error: string } {
  const trimmed = args.trim();

  // If no args, return null to indicate dialog mode
  if (!trimmed) {
    return { error: '' };
  }

  // Split by first whitespace to get trust level and path
  const firstSpaceIndex = trimmed.indexOf(' ');

  if (firstSpaceIndex === -1) {
    // Only trust level provided, no path
    return {
      error:
        'Target path is required. Usage: /permissions <TRUST_LEVEL> <path>',
    };
  }

  const trustLevelStr = trimmed.substring(0, firstSpaceIndex).trim();
  const targetPath = trimmed.substring(firstSpaceIndex + 1).trim();

  // Validate trust level
  if (!VALID_TRUST_LEVELS.includes(trustLevelStr as TrustLevel)) {
    return {
      error: `Invalid trust level: ${trustLevelStr}. Valid values: ${VALID_TRUST_LEVELS.join(', ')}`,
    };
  }

  if (!targetPath) {
    return {
      error:
        'Target path is required. Usage: /permissions <TRUST_LEVEL> <path>',
    };
  }

  const trustLevel = trustLevelStr as TrustLevel;

  // Normalize path (resolve relative paths, handle ~, etc.)
  let normalizedPath: string;
  if (path.isAbsolute(targetPath)) {
    normalizedPath = path.normalize(targetPath);
  } else {
    normalizedPath = path.resolve(workingDirectory, targetPath);
  }

  return { trustLevel, targetPath: normalizedPath };
}

export const permissionsCommand: SlashCommand = {
  name: 'permissions',
  description: 'manage folder trust settings',
  kind: CommandKind.BUILT_IN,
  action: (context, args) => {
    const parsed = parsePermissionsArgs(
      args,
      context.services.config?.getWorkingDir() ?? process.cwd(),
    );

    // If error is empty string, open dialog (no args case)
    if ('error' in parsed) {
      if (parsed.error === '') {
        return {
          type: 'dialog',
          dialog: 'permissions',
        };
      }
      // Non-empty error means invalid arguments
      return {
        type: 'message',
        messageType: 'error',
        content: parsed.error,
      };
    }

    // We have valid trust level and path, modify trust
    const { trustLevel, targetPath } = parsed;

    return (async (): Promise<OpenDialogActionReturn | MessageActionReturn> => {
      let trustedFolders: ReturnType<typeof loadTrustedFolders> | undefined;
      let savedSnapshot:
        | ReturnType<ReturnType<typeof loadTrustedFolders>['snapshotValue']>
        | undefined;
      const config = context.services.config;
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
    })();
  },
};
