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
import type {
  Agent,
  SessionProviderReads,
} from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assembleProfileDefinitions } from '@vybestack/llxprt-code-agents';
import type { RuntimeOwnerFeatures } from '../ui/contexts/RuntimeContext.js';

function bindProviderMutations(
  changeModel: RuntimeOwnerFeatures['setActiveModel'],
  modelParameters: Agent['modelParameters'],
  keys: Pick<Agent['auth']['keys'], 'setRaw'>,
): Pick<
  RuntimeOwnerFeatures,
  | 'setActiveModel'
  | 'setActiveModelParam'
  | 'clearActiveModelParam'
  | 'updateActiveProviderApiKey'
> {
  return {
    setActiveModel: changeModel,
    setActiveModelParam: (key, value) => modelParameters.set(key, value),
    clearActiveModelParam: (key) => modelParameters.clear(key),
    updateActiveProviderApiKey: (key) => keys.setRaw(key),
  };
}

export function createRuntimeOwnerFeatures(
  inspection: SessionProviderReads['inspection'],
  directories: () => readonly string[],
  changeModel: RuntimeOwnerFeatures['setActiveModel'],
  sessionSettings: SessionSettingsOperations,
  definitions: Pick<Agent['workspace'], 'profileDefinitions' | 'profileWrites'>,
  modelParameters: Agent['modelParameters'],
  settings: Agent['settings'],
  toolFormat: Agent['toolFormat'],
  reads: Pick<
    SessionProviderReads,
    | 'listProviders'
    | 'getActiveProviderName'
    | 'listAvailableModels'
    | 'getActiveModelName'
    | 'providerStatus'
    | 'getUnallowedParametersForActiveModel'
    | 'getActiveProviderMetrics'
    | 'getSessionTokenUsage'
    | 'getActiveModelParams'
  >,
  keys: Pick<Agent['auth']['keys'], 'setRaw'>,
  readOpenAI: RuntimeOwnerFeatures['getOpenAIProviderInfo'],
): RuntimeOwnerFeatures {
  return {
    listProviders: () => reads.listProviders(),
    getActiveModelParams: () => reads.getActiveModelParams(),
    getActiveProviderName: () => reads.getActiveProviderName(),
    listAvailableModels: (provider) => reads.listAvailableModels(provider),
    getActiveModelName: () => reads.getActiveModelName(),
    providerStatus: () => reads.providerStatus(),
    getEphemeralSettings: () => settings.getEphemeralSettings(),
    setEphemeralSetting: (key, value) =>
      settings.setEphemeralSetting(key, value),
    getUnallowedParametersForActiveModel: () =>
      reads.getUnallowedParametersForActiveModel(),
    ...assembleProfileDefinitions(
      definitions.profileDefinitions,
      definitions.profileWrites,
    ),
    ...inspection,
    getActiveToolFormatState: () => toolFormat.getState(),
    setActiveToolFormatOverride: (format) => toolFormat.setOverride(format),
    getActiveProviderMetrics: () => reads.getActiveProviderMetrics(),
    getSessionTokenUsage: () => reads.getSessionTokenUsage(),
    getEphemeralSetting: (key) => settings.getEphemeralSetting(key),
    getSessionSetting: (key) => settings.getSessionSetting(key),
    setSessionSetting: (key, value) => settings.setSessionSetting(key, value),
    clearSessionSetting: (key) => settings.clearSessionSetting(key),
    ...bindProviderMutations(changeModel, modelParameters, keys),
    getWorkspaceDirectories: () => [...directories()],
    getDefaultProfileName: () => sessionSettings.readDefaultProfileName(),
    getOpenAIProviderInfo: readOpenAI,
  };
}

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
