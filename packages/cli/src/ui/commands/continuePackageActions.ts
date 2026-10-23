/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandActionReturn } from './types.js';
import type { ContinueCommandOperations } from './continueCommand.js';

type PackageAction =
  | { readonly kind: 'import'; readonly packageDirectory: string }
  | {
      readonly kind: 'export';
      readonly sessionRef: string;
      readonly destination: string;
    };

function commandPayload(args: string, command: string): string | undefined {
  if (!args.startsWith(command)) return undefined;
  const suffix = args.slice(command.length);
  const separator = suffix.at(0);
  if (separator === undefined || separator.trim() !== '') return undefined;
  return suffix.trim();
}

function parsePackageAction(args: string): PackageAction | undefined {
  const importDirectory = commandPayload(args, 'import');
  if (importDirectory !== undefined && importDirectory.length > 0) {
    return { kind: 'import', packageDirectory: importDirectory };
  }
  const exportPayload = commandPayload(args, 'export');
  if (exportPayload === undefined) return undefined;
  const separatorIndex = exportPayload.search(/\s/u);
  if (separatorIndex < 1) return undefined;
  const destination = exportPayload.slice(separatorIndex).trim();
  return destination.length === 0
    ? undefined
    : {
        kind: 'export',
        sessionRef: exportPayload.slice(0, separatorIndex),
        destination,
      };
}

function errorAction(error: unknown): SlashCommandActionReturn {
  return {
    type: 'message',
    messageType: 'error',
    content: error instanceof Error ? error.message : String(error),
  };
}

function invalidPackageSyntax(
  args: string,
): SlashCommandActionReturn | undefined {
  if (args === 'import' || args.startsWith('import ')) {
    return errorAction('Usage: /continue import <package-directory>');
  }
  if (args === 'export' || args.startsWith('export ')) {
    return errorAction('Usage: /continue export <session> <destination>');
  }
  return undefined;
}

export async function handleContinuePackageActionForOwner(
  operations: ContinueCommandOperations,
  args: string,
  requiresConfirmation: boolean,
): Promise<SlashCommandActionReturn | undefined> {
  const action = parsePackageAction(args);
  if (action === undefined) return invalidPackageSyntax(args);
  try {
    if (action.kind === 'import') {
      if (requiresConfirmation && !operations.isInteractive()) {
        throw new Error(
          'Cannot replace active conversation in non-interactive mode.',
        );
      }
      const sessionPackage = await operations.validateSessionPackage(
        action.packageDirectory,
      );
      return {
        type: 'perform_resume',
        sessionPackage,
        ...(requiresConfirmation ? { requiresConfirmation: true } : {}),
      };
    }
    await operations.exportSession(action.sessionRef, action.destination);
    return {
      type: 'message',
      messageType: 'info',
      content: `Exported session package to ${action.destination}`,
    };
  } catch (error: unknown) {
    return errorAction(error);
  }
}
