/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback } from 'react';
import {
  SettingScope,
  type LoadedSettings,
} from '../../../../config/settings.js';
import type { IdeIntegrationNudgeResult } from '../../../IdeIntegrationNudge.js';
/**
 * IDE nudge resolution: slash-command-driven enable/install plus a persisted
 * "seen" flag so the nudge never renders twice.
 */
export function useIdePromptComplete(
  settings: Pick<LoadedSettings, 'setValue'>,
  handleSlashCommand: (query: string) => unknown,
  setIdePromptAnswered: (answered: boolean) => void,
) {
  return useCallback(
    (result: IdeIntegrationNudgeResult) => {
      if (result.userSelection === 'yes') {
        if (result.isExtensionPreInstalled) {
          void handleSlashCommand('/ide enable');
        } else {
          void handleSlashCommand('/ide install');
        }
        settings.setValue(
          SettingScope.User,
          'hasSeenIdeIntegrationNudge',
          true,
        );
      } else if (result.userSelection === 'dismiss') {
        settings.setValue(
          SettingScope.User,
          'hasSeenIdeIntegrationNudge',
          true,
        );
      }
      setIdePromptAnswered(true);
    },
    [handleSlashCommand, settings, setIdePromptAnswered],
  );
}
