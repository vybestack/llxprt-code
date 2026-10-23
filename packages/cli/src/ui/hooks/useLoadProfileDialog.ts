/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  useListSavedProfiles,
  useLoadProfileByName,
  useProviderStatus,
} from '../contexts/RuntimeContext.js';

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';

import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';
import {
  recordActiveProviderSwitch,
  type ProviderSwitchRecorder,
} from '../utils/recordActiveProviderSwitch.js';

interface UseLoadProfileDialogParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  dialogs: DialogOpeners;
  /** Where a profile load's provider switch is recorded. */
  recorder: ProviderSwitchRecorder | null;
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
  recorder,
}: UseLoadProfileDialogParams) => {
  const runtimeListSavedProfiles = useListSavedProfiles();
  const runtimeLoadProfileByName = useLoadProfileByName();
  const runtimeProviderStatus = useProviderStatus();
  const [profiles, setProfiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const openDialog = useCallback(async () => {
    // Clear old profiles and set loading state
    setProfiles([]);
    setIsLoading(true);

    // Open dialog immediately to show loading state
    dialogs.loadProfile.open({});

    try {
      const availableProfiles = await runtimeListSavedProfiles();
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
  }, [addMessage, dialogs, runtimeListSavedProfiles]);

  const handleSelect = useCallback(
    async (profileName: string) => {
      try {
        const result = await runtimeLoadProfileByName(profileName);
        const extra = formatInfoMessages(result);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' loaded${extra}`,
          timestamp: new Date(),
        });
        reportProfileWarnings(result.warnings, addMessage);
        await recordActiveProviderSwitch(
          recorder,
          { providerStatus: runtimeProviderStatus },
          (content) =>
            addMessage({
              type: MessageType.ERROR,
              content,
              timestamp: new Date(),
            }),
        );
      } catch (error) {
        handleProfileLoadError(error, profileName, addMessage);
      }
      dialogs.loadProfile.close();
    },
    [
      addMessage,
      dialogs,
      runtimeLoadProfileByName,
      runtimeProviderStatus,
      recorder,
    ],
  );

  return {
    openDialog,
    profiles,
    handleSelect,
    isLoading,
  };
};

function reportProfileWarnings(
  warnings: readonly string[],
  addMessage: UseLoadProfileDialogParams['addMessage'],
) {
  for (const warning of warnings)
    addMessage({
      type: MessageType.INFO,
      content: `⚠ ${warning}`,
      timestamp: new Date(),
    });
}
