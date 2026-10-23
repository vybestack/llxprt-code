/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { LoggingCommandOperations } from './loggingCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
export function bindLoggingCommand(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
): LoggingCommandOperations {
  return {
    isConfigured: config !== null,
    readTelemetry: () => settings.merged.telemetry,
    writeTelemetry: (value) =>
      settings.setValue(SettingScope.User, 'telemetry', value),
    readRuntimeTelemetry: () => {
      if (!config) throw new Error('Logging runtime unavailable');
      return config.getTelemetrySettings();
    },
    updateRuntimeTelemetry: async (value) => {
      if (!config) throw new Error('Logging runtime unavailable');
      await config.updateTelemetrySettings(value);
    },
    getConversationLogPath: () => {
      if (!config) throw new Error('Logging runtime unavailable');
      return config.getConversationLogPath();
    },
    getRedactionConfig: () => {
      if (!config) throw new Error('Logging runtime unavailable');
      return config.getRedactionConfig();
    },
    addItem,
  };
}
