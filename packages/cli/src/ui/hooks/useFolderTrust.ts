/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { ExitCodes } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { LoadedSettings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import {
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  TrustLevel,
  isWorkspaceTrusted,
  type TrustedFolderSnapshot,
} from '../../config/trustedFolders.js';
import { type HistoryItemWithoutId, MessageType } from '../types.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import process from 'node:process';
import { getTrustCommitErrorMessage } from '../trustDialogHelpers.js';

export type FolderTrustRuntime = Pick<
  CliUiRuntime,
  'getWorkingDir' | 'setTrustedFolderLive' | 'isTrustedFolder'
>;

const debug = new DebugLogger('llxprt:ui:useFolderTrust');

type AddItemFn = (item: HistoryItemWithoutId, timestamp: number) => number;
type SetDialogOpenFn = (open: boolean) => void;

function getTrustLevelFromChoice(choice: FolderTrustChoice): TrustLevel | null {
  switch (choice) {
    case FolderTrustChoice.TRUST_FOLDER:
      return TrustLevel.TRUST_FOLDER;
    case FolderTrustChoice.TRUST_PARENT:
      return TrustLevel.TRUST_PARENT;
    case FolderTrustChoice.DO_NOT_TRUST:
      return TrustLevel.DO_NOT_TRUST;
    default:
      return null;
  }
}

function showStartupMessage(
  trusted: boolean | undefined = undefined,
  addItem: AddItemFn | undefined,
  startupMessageSent: React.MutableRefObject<boolean>,
): void {
  if (trusted === false && !startupMessageSent.current) {
    debug.log(
      'Folder is untrusted - displaying permissions command hint on startup',
    );
    addItem?.(
      {
        type: MessageType.INFO,
        text: 'This folder is not trusted. Some features may be disabled. Use the `/permissions` command to change the trust level.',
      },
      Date.now(),
    );
    startupMessageSent.current = true;
  }
}

async function applyFolderTrustChoice(
  choice: FolderTrustChoice,
  settings: LoadedSettings,
  config: FolderTrustRuntime | undefined,
  addItem: AddItemFn | undefined,
  setDialogOpen: SetDialogOpenFn,
): Promise<void> {
  const trustLevel = getTrustLevelFromChoice(choice);
  if (trustLevel === null) {
    return;
  }
  const workingDirectory = config?.getWorkingDir() ?? process.cwd();
  let trustedFolders: ReturnType<typeof loadTrustedFolders> | undefined;
  let savedSnapshot: TrustedFolderSnapshot | undefined;
  let previousLiveTrust = false;
  let failedPhase: 'persistence' | 'live' = 'persistence';
  try {
    trustedFolders = loadTrustedFolders();
    savedSnapshot = trustedFolders.snapshotValue(workingDirectory);
    previousLiveTrust = config?.isTrustedFolder() ?? false;
    trustedFolders.setValue(workingDirectory, trustLevel);
    failedPhase = 'live';
    const newIsTrusted =
      resolveLocalWorkspaceTrust(
        settings.merged,
        trustedFolders,
        workingDirectory,
      ) ?? false;
    await config?.setTrustedFolderLive(newIsTrusted);
    setDialogOpen(false);
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    if (trustedFolders !== undefined && savedSnapshot !== undefined) {
      try {
        trustedFolders.restoreSnapshot(savedSnapshot);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (failedPhase === 'live') {
      try {
        await config?.setTrustedFolderLive(previousLiveTrust);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    const reportedError =
      rollbackFailures.length === 0
        ? error
        : new AggregateError(
            [error, ...rollbackFailures],
            'Trust update and rollback failed',
          );
    const message = `${getTrustCommitErrorMessage(
      failedPhase,
      reportedError,
      rollbackFailures.length === 0,
    )} Exiting LLxprt Code.`;
    debug.error(message);
    addItem?.({ type: MessageType.ERROR, text: message }, Date.now());
    setTimeout(() => process.exit(ExitCodes.FATAL_CONFIG_ERROR), 100);
  }
}

export const useFolderTrust = (
  settings: LoadedSettings,
  addItem?: AddItemFn,
  config?: FolderTrustRuntime,
) => {
  const { folderTrust } = settings.merged;
  const initialTrust = isWorkspaceTrusted(
    settings.merged,
    config?.getWorkingDir() ?? process.cwd(),
  );
  const [isFolderTrustDialogOpen, setIsFolderTrustDialogOpen] = useState(
    initialTrust === undefined,
  );
  const startupMessageSent = useRef(false);
  const previousFolderTrust = useRef(folderTrust);

  useEffect(() => {
    const folderTrustChanged = previousFolderTrust.current !== folderTrust;
    previousFolderTrust.current = folderTrust;
    const trusted = isWorkspaceTrusted(
      settings.merged,
      config?.getWorkingDir() ?? process.cwd(),
    );
    if (folderTrustChanged) {
      setIsFolderTrustDialogOpen(trusted === undefined);
    }
    showStartupMessage(trusted, addItem, startupMessageSent);
  }, [folderTrust, addItem, config, settings.merged]);

  const handleFolderTrustSelect = useCallback(
    (choice: FolderTrustChoice): Promise<void> =>
      applyFolderTrustChoice(
        choice,
        settings,
        config,
        addItem,
        setIsFolderTrustDialogOpen,
      ),
    [addItem, config, settings],
  );

  return { isFolderTrustDialogOpen, handleFolderTrustSelect };
};
