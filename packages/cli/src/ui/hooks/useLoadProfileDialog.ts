/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

interface UseLoadProfileDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  dialogs: DialogOpeners;
}

function formatInfoMessages(result: { infoMessages: string[] }): string {
  return result.infoMessages.map((message) => `\n- ${message}`).join('');
}

function handleProfileLoadError(
  error: unknown,
  profileName: string,
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void,
): void {
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      addMessage({
        type: MessageType.ERROR,
        content: `Profile '${profileName}' not found`,
        timestamp: new Date(),
      });
    } else if (error.message.includes('corrupted')) {
      addMessage({
        type: MessageType.ERROR,
        content: `Profile '${profileName}' is corrupted`,
        timestamp: new Date(),
      });
    } else if (error.message.includes('missing required fields')) {
      addMessage({
        type: MessageType.ERROR,
        content: `Profile '${profileName}' is invalid: missing required fields`,
        timestamp: new Date(),
      });
    } else {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load profile: ${error.message}`,
        timestamp: new Date(),
      });
    }
  } else {
    addMessage({
      type: MessageType.ERROR,
      content: `Failed to load profile: ${String(error)}`,
      timestamp: new Date(),
    });
  }
}

export const useLoadProfileDialog = ({
  addMessage,
  dialogs,
}: UseLoadProfileDialogParams) => {
  const runtime = useRuntimeApi();
  const [profiles, setProfiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const openDialog = useCallback(async () => {
    // Clear old profiles and set loading state
    setProfiles([]);
    setIsLoading(true);

    // Open dialog immediately to show loading state
    dialogs.loadProfile.open({});

    try {
      const availableProfiles = await runtime.listSavedProfiles();
      setProfiles(availableProfiles);
    } catch (e) {
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load profiles: ${e instanceof Error ? e.message : String(e)}`,
        timestamp: new Date(),
      });
      // Close dialog on error
      dialogs.loadProfile.close();
    } finally {
      setIsLoading(false);
    }
  }, [addMessage, dialogs, runtime]);

  const handleSelect = useCallback(
    async (profileName: string) => {
      try {
        const result = await runtime.loadProfileByName(profileName);
        const extra = formatInfoMessages(result);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' loaded${extra}`,
          timestamp: new Date(),
        });
        for (const warning of result.warnings) {
          addMessage({
            type: MessageType.INFO,
            content: `⚠ ${warning}`,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        handleProfileLoadError(error, profileName, addMessage);
      }
      dialogs.loadProfile.close();
    },
    [addMessage, dialogs, runtime],
  );

  return {
    openDialog,
    profiles,
    handleSelect,
    isLoading,
  };
};
