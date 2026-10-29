import type { BrowserListing } from './browserCatalogHost.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import { validateSessionMediaPackage } from '@vybestack/llxprt-code-core';
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
  listRawTargets: () => Promise<
    Pick<BrowserListing, 'targets' | 'unreadableRecordings'>
  >,
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
        listRawTargets,
        recordingOwner,
      ),
    [
      exportSession,
      isInteractive,
      listOwnedTargets,
      readChatsDir,
      readProjectHash,
      listRawTargets,
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
  listRawTargets: () => Promise<
    Pick<BrowserListing, 'targets' | 'unreadableRecordings'>
  >,
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
      const result = await listRawTargets();
      warnUnreadableRecordings(
        '/continue completions',
        result.unreadableRecordings,
      );
      return [...result.targets];
    },
    validateSessionPackage: validateSessionMediaPackage,
  });
}
