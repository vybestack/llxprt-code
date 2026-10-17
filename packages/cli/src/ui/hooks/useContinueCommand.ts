/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import {
  SessionDiscovery,
  validateSessionMediaPackage,
  type LocalMediaStore,
} from '@vybestack/llxprt-code-core';
import type { ContinueCommandOperations } from '../commands/continueCommand.js';
import { createContinueCommand } from '../commands/continueCommand.js';
import { warnUnreadableRecordings } from '../utils/warnUnreadableRecordings.js';

export function useContinueCommand(
  exportSession: ContinueCommandOperations['exportSession'],
  isInteractive: ContinueCommandOperations['isInteractive'],
  listOwnedTargets: () => Promise<
    Readonly<
      Awaited<ReturnType<ContinueCommandOperations['listContinueTargets']>>
    >
  >,
  readChatsDir: () => string | null,
  readProjectHash: () => string | null,
  mediaStore: LocalMediaStore | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
) {
  return useMemo(
    () =>
      createContinueRegistration(
        exportSession,
        isInteractive,
        listOwnedTargets,
        readChatsDir,
        readProjectHash,
        mediaStore,
        recordingOwner,
      ),
    [
      exportSession,
      isInteractive,
      listOwnedTargets,
      readChatsDir,
      readProjectHash,
      mediaStore,
      recordingOwner,
    ],
  );
}

export function createContinueRegistration(
  exportSession: ContinueCommandOperations['exportSession'],
  isInteractive: ContinueCommandOperations['isInteractive'],
  listOwnedTargets: () => Promise<
    Readonly<
      Awaited<ReturnType<ContinueCommandOperations['listContinueTargets']>>
    >
  >,
  readChatsDir: () => string | null,
  readProjectHash: () => string | null,
  mediaStore: LocalMediaStore | undefined,
  recordingOwner: 'agent' | 'raw' | undefined,
) {
  return createContinueCommand({
    exportSession,
    isInteractive,
    listContinueTargets: async () => {
      const chatsDir = readChatsDir();
      const projectHash = readProjectHash();
      if (chatsDir === null || projectHash === null)
        throw new Error('Session configuration is unavailable');
      if (recordingOwner === 'agent') return [...(await listOwnedTargets())];
      const result = await SessionDiscovery.listContinueTargetsDetailed(
        chatsDir,
        projectHash,
        mediaStore,
      );
      warnUnreadableRecordings(
        '/continue completions',
        result.unreadableRecordings,
      );
      return result.targets;
    },
    validateSessionPackage: validateSessionMediaPackage,
  });
}
