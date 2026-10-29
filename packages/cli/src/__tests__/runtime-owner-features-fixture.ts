/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  assembleProfileDefinitions,
  type Agent,
  type SessionProviderReads,
} from '@vybestack/llxprt-code-agents';
import type { SessionSettingsOperations } from '../runtime/createRuntimeOwnerFeatures.js';
import type { RuntimeOwnerFeatures } from './runtime-context-fixture.js';
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
