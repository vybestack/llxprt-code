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
} from '../../config/trustedFolders.js';
import { type HistoryItemWithoutId, MessageType } from '../types.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import process from 'node:process';

export type FolderTrustRuntime = Pick<
  CliUiRuntime,
  'getWorkingDir' | 'setTrustedFolderLive'
>;

const debug = new DebugLogger('llxprt:ui:useFolderTrust');

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

function saveTrustLevel(
  cwd: string,
  trustLevel: TrustLevel,
  addItem?: AddItemFn,
): boolean {
  try {
    const trustedFolders = loadTrustedFolders();
    trustedFolders.setValue(cwd, trustLevel);
    return true;
  } catch {
    if (addItem) {
      addItem(
        {
          type: MessageType.ERROR,
          text: 'Failed to save trust settings. Exiting LLxprt Code.',
        },
        Date.now(),
      );
    }
    setTimeout(() => {
      process.exit(ExitCodes.FATAL_CONFIG_ERROR);
    }, 100);
    return false;
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
    if (addItem) {
      addItem(
        {
          type: MessageType.INFO,
          text: 'This folder is not trusted. Some features may be disabled. Use the `/permissions` command to change the trust level.',
        },
        Date.now(),
      );
    }
    startupMessageSent.current = true;
  }
}

export const useFolderTrust = (
  settings: LoadedSettings,
  addItem?: AddItemFn,
  config?: CliUiRuntime,
) => {
  // Folder trust feature flag removed - now using settings directly
  const { folderTrust } = settings.merged;
  const workingDirectory = config?.getWorkingDir() ?? process.cwd();
  const initialTrust = isWorkspaceTrusted(settings.merged, workingDirectory);
  const [isFolderTrustDialogOpen, setIsFolderTrustDialogOpen] = useState(
    initialTrust === undefined,
  );
  const startupMessageSent = useRef(false);
  const previousFolderTrust = useRef(folderTrust);

  useEffect(() => {
    const folderTrustChanged = previousFolderTrust.current !== folderTrust;
    previousFolderTrust.current = folderTrust;
    const trusted = isWorkspaceTrusted(settings.merged, workingDirectory);
    if (folderTrustChanged) {
      setIsFolderTrustDialogOpen(trusted === undefined);
    }

    showStartupMessage(trusted, addItem, startupMessageSent);
  }, [folderTrust, addItem, settings.merged, workingDirectory]);

  const handleFolderTrustSelect = useCallback(
    (choice: FolderTrustChoice) => {
      const trustLevel = getTrustLevelFromChoice(choice);
      if (trustLevel === null) {
        return;
      }

      if (!saveTrustLevel(workingDirectory, trustLevel, addItem)) {
        return;
      }

      const newIsTrusted =
        resolveLocalWorkspaceTrust(
          settings.merged,
          loadTrustedFolders(),
          workingDirectory,
        ) ?? false;
      setIsFolderTrustDialogOpen(false);

      config?.setTrustedFolderLive(newIsTrusted);
    },
    [addItem, config, settings.merged, workingDirectory],
  );

  return {
    isFolderTrustDialogOpen,
    handleFolderTrustSelect,
  };
};
