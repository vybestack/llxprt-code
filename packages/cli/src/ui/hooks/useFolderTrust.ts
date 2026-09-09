/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import { ExitCodes } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { LoadedSettings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import {
  isWorkspaceTrusted,
  TrustLevel,
  loadTrustedFolders,
  resolveLocalWorkspaceTrust,
  type TrustedFolderSnapshot,
} from '../../config/trustedFolders.js';
import { type HistoryItemWithoutId, MessageType } from '../types.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import process from 'node:process';
import {
  combineTrustUpdateFailure,
  getTrustCommitErrorMessage,
} from '../trustDialogHelpers.js';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';

const debug = new DebugLogger('llxprt:ui:useFolderTrust');

export type FolderTrustRuntime = Pick<
  CliUiRuntime,
  'getWorkingDir' | 'setTrustedFolderLive' | 'isTrustedFolder'
>;

type AddItemFn = (item: HistoryItemWithoutId, timestamp: number) => number;

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
  trusted: boolean | undefined,
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
  closeDialog: () => void,
  mountedRef: React.MutableRefObject<boolean>,
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
    const newIsTrusted =
      resolveLocalWorkspaceTrust(
        settings.merged,
        trustedFolders,
        workingDirectory,
      ) ?? false;
    failedPhase = 'live';
    await config?.setTrustedFolderLive(newIsTrusted);
    if (mountedRef.current) {
      closeDialog();
    }
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
    if (!mountedRef.current) {
      return;
    }
    const failure = combineTrustUpdateFailure(
      error,
      rollbackFailures,
      'Trust update and rollback failed',
    );
    const message = `${getTrustCommitErrorMessage(
      failedPhase,
      failure.error,
      failure.rollbackSucceeded,
    )} Exiting LLxprt Code.`;
    debug.error(message);
    addItem?.({ type: MessageType.ERROR, text: message }, Date.now());
    setTimeout(() => process.exit(ExitCodes.FATAL_CONFIG_ERROR), 100);
  }
}

interface UseFolderTrustParams {
  settings: LoadedSettings;
  addItem?: AddItemFn;
  config?: FolderTrustRuntime;
  store: DialogStore;
  dialogs: DialogOpeners;
}

export const useFolderTrust = ({
  settings,
  addItem,
  config,
  store,
  dialogs,
}: UseFolderTrustParams) => {
  const trusted = isWorkspaceTrusted(
    settings.merged,
    config?.getWorkingDir() ?? process.cwd(),
  );
  const isFolderTrustDialogOpen = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'folderTrust'),
  );
  const startupMessageSent = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The dialog is open exactly while workspace trust is undecided; open and
  // close are idempotent so re-running with the same verdict is a no-op.
  useEffect(() => {
    if (trusted === undefined) {
      dialogs.folderTrust.open({});
    } else {
      dialogs.folderTrust.close();
    }
  }, [trusted, dialogs]);

  useEffect(() => {
    showStartupMessage(trusted, addItem, startupMessageSent);
  }, [trusted, addItem]);

  const handleFolderTrustSelect = useCallback(
    (choice: FolderTrustChoice): Promise<void> =>
      applyFolderTrustChoice(
        choice,
        settings,
        config,
        addItem,
        dialogs.folderTrust.close,
        mountedRef,
      ),
    [addItem, config, settings, dialogs],
  );

  return { isFolderTrustDialogOpen, handleFolderTrustSelect };
};
