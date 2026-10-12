type SessionSettingsOwner = NonNullable<FromConfigOptions['settingsOwner']>;
import {
  logUserPrompt,
  logSlashCommand,
} from '@vybestack/llxprt-code-telemetry';
import type {
  SettingsTelemetryState,
  StreamRuntimeDeclarationSource,
} from '../ui/cliUiRuntime.js';
import type {
  Agent,
  FromConfigOptions,
  SessionProviderReads,
} from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimeProviderManager,
  Config,
} from '@vybestack/llxprt-code-core';

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';
import { refreshAliasProviders } from '@vybestack/llxprt-code-providers/composition.js';
import { assembleProfileDefinitions } from '@vybestack/llxprt-code-agents';
import type { RuntimeOwnerFeatures } from '../ui/contexts/RuntimeContext.js';
import type { ProviderAliasRefresh } from '../ui/contexts/ProviderAliasRefreshContext.js';
import { createProviderInspection } from './providerInspection.js';

export function createProviderAliasRefresh(
  manager: RuntimeProviderManager,
): ProviderAliasRefresh {
  return () => {
    refreshAliasProviders(manager);
    return Promise.resolve();
  };
}

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
  owner: Config,
  manager: RuntimeProviderManager,
  directories: () => readonly string[],
  changeModel: RuntimeOwnerFeatures['setActiveModel'],
  sessionSettings: SessionSettingsOwner,
  settingsService: SettingsService,
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
): RuntimeOwnerFeatures {
  sessionSettings.assertSettingsIdentity(settingsService);
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
    ...createProviderInspection(
      () => sessionSettings.readSelectedEndpoint(),
      manager,
    ),
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
    getDefaultProfileName: () =>
      typeof settingsService.get('defaultProfile') === 'string'
        ? String(settingsService.get('defaultProfile'))
        : null,
    getOpenAIProviderInfo: () =>
      getOpenAIProviderInfo({ settingsService, config: owner }, manager),
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
