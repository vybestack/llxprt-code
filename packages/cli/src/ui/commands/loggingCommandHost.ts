/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import type {
  TelemetrySettings,
  RedactionConfig,
} from '@vybestack/llxprt-code-core';
import type { LoggingCommandOperations } from './loggingCommand.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

/**
 * Runtime telemetry/logging reads used by /logging.
 */
export interface LoggingCommandRuntime {
  getTelemetrySettings(): TelemetrySettings;
  updateTelemetrySettings(settings: Partial<TelemetrySettings>): Promise<void>;
  getConversationLogPath(): string;
  getRedactionConfig(): RedactionConfig;
}

export function bindLoggingCommand(
  runtime: LoggingCommandRuntime | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
): LoggingCommandOperations {
  return {
    isConfigured: runtime !== null,
    readTelemetry: () => settings.merged.telemetry,
    writeTelemetry: (value) =>
      settings.setValue(SettingScope.User, 'telemetry', value),
    readRuntimeTelemetry: () => {
      if (!runtime) throw new Error('Logging runtime unavailable');
      return runtime.getTelemetrySettings();
    },
    updateRuntimeTelemetry: async (value) => {
      if (!runtime) throw new Error('Logging runtime unavailable');
      await runtime.updateTelemetrySettings(value);
    },
    getConversationLogPath: () => {
      if (!runtime) throw new Error('Logging runtime unavailable');
      return runtime.getConversationLogPath();
    },
    getRedactionConfig: () => {
      if (!runtime) throw new Error('Logging runtime unavailable');
      return runtime.getRedactionConfig();
    },
    addItem,
  };
}
