/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core';
export type SessionSettingsOperations = Pick<
  SessionSettingsOwner,
  | 'logUserPrompt'
  | 'logSlashCommand'
  | 'isTelemetryEnabled'
  | 'flushTelemetry'
  | 'readNamedParameter'
  | 'readDefaultProfileName'
  | 'readTelemetrySettings'
  | 'updateTelemetrySettings'
  | 'readConversationLoggingEnabled'
  | 'subscribeModelChanges'
>;
import type {
  SettingsTelemetryState,
  StreamRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

export function buildSettingsRuntime(
  source: StreamRuntimeDeclarationSource,
  agent: Pick<
    Agent,
    'getEphemeralSetting' | 'getActiveProfileName' | 'getProvider' | 'onStats'
  >,
  telemetrySettings?: SessionSettingsOperations,
): SettingsTelemetryState {
  const selectedTelemetry = (): SessionSettingsOperations => {
    if (telemetrySettings === undefined)
      throw new Error('UI telemetry requires selected session settings');
    return telemetrySettings;
  };
  return {
    logUserPrompt: (event) => {
      if (telemetrySettings === undefined)
        throw new Error('UI prompt telemetry requires selected settings');
      telemetrySettings.logUserPrompt(source, event);
    },
    logSlashCommand: (event) => {
      if (telemetrySettings === undefined)
        throw new Error('UI command telemetry requires selected settings');
      telemetrySettings.logSlashCommand(source, event);
    },
    readCitations: () => agent.getEphemeralSetting('ui.showCitations'),
    readProfileName: () => agent.getActiveProfileName(),
    readSelectedProvider: () => agent.getProvider(),
    subscribeModelSelection: (listener) =>
      selectedTelemetry().subscribeModelChanges(listener),
    getProxy: () => source.getProxy(),
    getBugCommand: () => source.getBugCommand(),
    getTelemetrySettings: () => selectedTelemetry().readTelemetrySettings(),
    updateTelemetrySettings: async (settings) => {
      if (telemetrySettings === undefined)
        throw new Error(
          'UI telemetry updates require selected session settings',
        );
      await telemetrySettings.updateTelemetrySettings(settings);
    },
    getTelemetryLogPromptsEnabled: () =>
      selectedTelemetry().readTelemetrySettings().logPrompts === true,
    getTelemetryEnabled: () => selectedTelemetry().isTelemetryEnabled(),
    getTelemetryOutfile: () =>
      selectedTelemetry().readTelemetrySettings().outfile,
    getConversationLoggingEnabled: () =>
      selectedTelemetry().readConversationLoggingEnabled(),
    getEmbeddingModel: () => source.getEmbeddingModel(),
    getSandbox: () => source.getSandbox(),
    getRedactionConfig: () => source.getRedactionConfig(),
  };
}
