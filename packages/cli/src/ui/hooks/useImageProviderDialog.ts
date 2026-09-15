/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import {
  listImageProviders,
  pinImageProvider,
} from '../commands/providerSelection.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import { MessageType } from '../types.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

interface UseImageProviderDialogParams {
  settings: LoadedSettings;
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  dialogs: DialogOpeners;
}

/**
 * Image-provider picker mirroring useProviderDialog: the alias menu comes
 * from loadProviderAliasEntries(), the effective selection is the pinned
 * imageProvider setting falling back to the active text provider, and a
 * selection pins through the shared pinImageProvider path.
 */
export const useImageProviderDialog = ({
  settings,
  addMessage,
  dialogs,
}: UseImageProviderDialogParams) => {
  const runtime = useRuntimeApi();
  const [providers, setProviders] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<string>('');

  const openDialog = useCallback(() => {
    try {
      setProviders(listImageProviders());
      setCurrentProvider(
        settings.merged.imageProvider ?? runtime.getActiveProviderName(),
      );
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: e instanceof Error ? e.message : String(e),
        timestamp: new Date(),
      });
      return;
    }
    dialogs.imageProvider.open({});
  }, [addMessage, dialogs, runtime, settings]);

  const handleSelect = useCallback(
    (alias: string) => {
      try {
        pinImageProvider(settings, runtime, alias);
        addMessage({
          type: MessageType.INFO,
          content: `Image provider set to ${alias}`,
          timestamp: new Date(),
        });
      } catch (e) {
        addMessage({
          type: MessageType.ERROR,
          content: e instanceof Error ? e.message : String(e),
          timestamp: new Date(),
        });
      } finally {
        dialogs.imageProvider.close();
      }
    },
    [addMessage, dialogs, runtime, settings],
  );

  return {
    openDialog,
    providers,
    currentProvider,
    handleSelect,
  };
};
