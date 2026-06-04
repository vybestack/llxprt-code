/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  type Config,
  DebugLogger,
  ExitCodes,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings, Settings } from '../../config/settings.js';
import { FolderTrustChoice } from '../components/FolderTrustDialog.js';
import {
  loadTrustedFolders,
  TrustLevel,
  isWorkspaceTrusted,
} from '../../config/trustedFolders.js';
import { type HistoryItemWithoutId, MessageType } from '../types.js';
import process from 'node:process';

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

function computeNewTrustedState(trustLevel: TrustLevel): boolean {
  return (
    trustLevel === TrustLevel.TRUST_FOLDER ||
    trustLevel === TrustLevel.TRUST_PARENT
  );
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
  config: Config,
  addItem?: AddItemFn,
) => {
  const [isTrusted, setIsTrusted] = useState<boolean | undefined>(
    config.isTrustedFolder(),
  );
  const [isFolderTrustDialogOpen, setIsFolderTrustDialogOpen] = useState(
    (config.isTrustedFolder() as boolean | undefined) === undefined,
  );
  const [isRestarting, setIsRestarting] = useState(false);
  const startupMessageSent = useRef(false);

  // Folder trust feature flag removed - now using settings directly
  const { folderTrust } = settings.merged;

  useEffect(() => {
    const trusted = isWorkspaceTrusted({
      folderTrust,
    } as Settings);
    setIsTrusted(trusted);
    if (trusted === undefined) {
      setIsFolderTrustDialogOpen(true);
    }

    showStartupMessage(trusted, addItem, startupMessageSent);
  }, [folderTrust, addItem]);

  const handleFolderTrustSelect = useCallback(
    (choice: FolderTrustChoice) => {
      const trustLevel = getTrustLevelFromChoice(choice);
      if (trustLevel === null) {
        return;
      }

      const cwd = process.cwd();
      const wasTrusted = isTrusted ?? false;

      if (!saveTrustLevel(cwd, trustLevel, addItem)) {
        return;
      }

      const newIsTrusted = computeNewTrustedState(trustLevel);
      setIsTrusted(newIsTrusted);

      const needsRestart = wasTrusted !== newIsTrusted;
      if (needsRestart) {
        setIsRestarting(true);
        setIsFolderTrustDialogOpen(true);
      } else {
        setIsFolderTrustDialogOpen(false);
      }
    },
    [isTrusted, addItem],
  );

  return {
    isFolderTrustDialogOpen,
    handleFolderTrustSelect,
    isRestarting,
  };
};
