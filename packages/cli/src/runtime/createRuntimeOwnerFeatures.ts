/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
type SessionSettingsOwner = NonNullable<FromConfigOptions['settingsOwner']>;
import {
  logUserPrompt,
  logSlashCommand,
} from '@vybestack/llxprt-code-telemetry';
import type {
  SettingsTelemetryState,
  StreamRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';
import type { Agent, FromConfigOptions } from '@vybestack/llxprt-code-agents';

import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';

import { refreshAliasProviders } from '@vybestack/llxprt-code-providers/composition.js';

import type { ProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';

export function createProviderAliasRefresh(
  manager: RuntimeProviderManager,
): ProviderAliasRefresh {
  return () => {
    refreshAliasProviders(manager);
    return Promise.resolve();
  };
}

export function buildSettingsRuntime(
  source: StreamRuntimeDeclarationSource,
  agent: Pick<
    Agent,
    'getEphemeralSetting' | 'getActiveProfileName' | 'getProvider' | 'onStats'
  >,
  telemetrySettings?: SessionSettingsOwner,
): SettingsTelemetryState {
  const selectedTelemetry = (): SessionSettingsOwner => {
    if (telemetrySettings === undefined)
      throw new Error('UI telemetry requires selected session settings');
    return telemetrySettings;
  };
  return {
    logUserPrompt: (event) => {
      if (telemetrySettings === undefined)
        throw new Error('UI prompt telemetry requires selected settings');
      logUserPrompt(source, event, telemetrySettings.telemetry);
    },
    logSlashCommand: (event) => {
      if (telemetrySettings === undefined)
        throw new Error('UI command telemetry requires selected settings');
      logSlashCommand(source, event, telemetrySettings.telemetry);
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
    getTelemetryEnabled: () => selectedTelemetry().telemetry.isEnabled(),
    getTelemetryOutfile: () =>
      selectedTelemetry().readTelemetrySettings().outfile,
    getConversationLoggingEnabled: () =>
      selectedTelemetry().readConversationLoggingEnabled(),
    getEmbeddingModel: () => source.getEmbeddingModel(),
    getSandbox: () => source.getSandbox(),
    getRedactionConfig: () => source.getRedactionConfig(),
  };
}
