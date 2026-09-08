/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  exportSessionMediaPackage,
  SessionDiscovery,
  validateSessionMediaPackage,
} from '@vybestack/llxprt-code-core';
import { basename } from 'node:path';
import type { CommandContext, SlashCommandActionReturn } from './types.js';

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

async function importPackage(
  ctx: CommandContext,
  action: Extract<PackageAction, { kind: 'import' }>,
  requiresConfirmation: boolean,
): Promise<SlashCommandActionReturn> {
  const config = ctx.services.config;
  if (config === null) throw new Error('Session configuration is unavailable');
  if (requiresConfirmation && !config.isInteractive()) {
    throw new Error(
      'Cannot replace active conversation in non-interactive mode.',
    );
  }
  const sessionPackage = await validateSessionMediaPackage(
    action.packageDirectory,
  );
  return {
    type: 'perform_resume',
    sessionPackage,
    ...(requiresConfirmation ? { requiresConfirmation: true } : {}),
  };
}

async function exportPackage(
  ctx: CommandContext,
  action: Extract<PackageAction, { kind: 'export' }>,
): Promise<SlashCommandActionReturn> {
  const config = ctx.services.config;
  if (config === null) throw new Error('Session configuration is unavailable');
  const chatsDir = config.storage.getProjectChatsDir();
  const projectHash = basename(config.storage.getProjectTempDir());
  const mediaStore = config.getLocalMediaStore();
  const targets = await SessionDiscovery.listContinueTargets(
    chatsDir,
    projectHash,
    mediaStore,
  );
  const resolved = SessionDiscovery.resolveContinueRef(
    action.sessionRef,
    targets,
  );
  if ('error' in resolved) throw new Error(resolved.error);
  const source =
    resolved.target.kind === 'session'
      ? resolved.target.session
      : resolved.target.source;
  const activeRecording = config.getSessionRecordingService?.();
  if (activeRecording?.getSessionId() === source.sessionId) {
    if (ctx.recordingIntegration !== undefined) {
      await ctx.recordingIntegration.flushAtTurnBoundary();
    }
    await activeRecording.flush();
  }
  await exportSessionMediaPackage(
    source.filePath,
    projectHash,
    mediaStore,
    action.destination,
  );
  return {
    type: 'message',
    messageType: 'info',
    content: `Exported session package to ${action.destination}`,
  };
}

export async function handleContinuePackageAction(
  ctx: CommandContext,
  args: string,
  requiresConfirmation: boolean,
): Promise<SlashCommandActionReturn | undefined> {
  const action = parsePackageAction(args);
  if (action === undefined) {
    if (args === 'import' || args.startsWith('import ')) {
      return errorAction('Usage: /continue import <package-directory>');
    }
    if (args === 'export' || args.startsWith('export ')) {
      return errorAction('Usage: /continue export <session> <destination>');
    }
    return undefined;
  }
  try {
    return action.kind === 'import'
      ? await importPackage(ctx, action, requiresConfirmation)
      : await exportPackage(ctx, action);
  } catch (error) {
    return errorAction(error);
  }
}
