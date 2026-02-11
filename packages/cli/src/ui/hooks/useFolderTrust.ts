/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { type Config, DebugLogger } from '@vybestack/llxprt-code-core';
import { LoadedSettings, Settings } from '../../config/settings.js';
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

export const useFolderTrust = (
  settings: LoadedSettings,
  config: Config,
  addItem?: AddItemFn,
) => {
  const [isTrusted, setIsTrusted] = useState<boolean | undefined>(
    config.isTrustedFolder(),
  );
  const [isFolderTrustDialogOpen, setIsFolderTrustDialogOpen] = useState(
    config.isTrustedFolder() === undefined,
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

    // Show a message about permissions command when folder is untrusted
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
  }, [folderTrust, addItem]);

  const handleFolderTrustSelect = useCallback(
    (choice: FolderTrustChoice) => {
      const trustedFolders = loadTrustedFolders();
      const cwd = process.cwd();
      let trustLevel: TrustLevel;

      const wasTrusted = isTrusted ?? true;

      switch (choice) {
        case FolderTrustChoice.TRUST_FOLDER:
          trustLevel = TrustLevel.TRUST_FOLDER;
          break;
        case FolderTrustChoice.TRUST_PARENT:
          trustLevel = TrustLevel.TRUST_PARENT;
          break;
        case FolderTrustChoice.DO_NOT_TRUST:
          trustLevel = TrustLevel.DO_NOT_TRUST;
          break;
        default:
          return;
      }

      try {
        trustedFolders.setValue(cwd, trustLevel);
      } catch (_e) {
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
          process.exit(1);
        }, 100);
        return;
      }

      const newIsTrusted =
        trustLevel === TrustLevel.TRUST_FOLDER ||
        trustLevel === TrustLevel.TRUST_PARENT;
      setIsTrusted(newIsTrusted);

      // Trust state is managed by trustedFolders and doesn't need to be set on config

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
