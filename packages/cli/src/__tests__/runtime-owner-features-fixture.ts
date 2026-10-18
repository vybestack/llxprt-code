/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
type SessionSettingsOwner = NonNullable<FromConfigOptions['settingsOwner']>;

import type {
  Agent,
  FromConfigOptions,
  SessionProviderReads,
} from '@vybestack/llxprt-code-agents';

import type {
  RuntimeProviderManager,
  Config,
} from '@vybestack/llxprt-code-core';

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';

import { assembleProfileDefinitions } from '@vybestack/llxprt-code-agents';
import type { RuntimeOwnerFeatures } from './runtime-context-fixture.js';

import { createProviderInspection } from '../runtime/providerInspection.js';

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
