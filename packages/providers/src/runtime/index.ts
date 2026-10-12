/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { admitModelParameters } from './admitModelParameters.js';
export { admitLoadBalancerModelParameters } from './admitLoadBalancerModelParameters.js';
export { createProviderKeyStorage } from '../auth/index.js';
export {
  createRuntimeActivationBindings,
  createIsolatedRuntimeContext,
} from './runtimeActivationBindings.js';
export type {
  IsolatedRuntimeContextOptions,
  IsolatedRuntimeContextHandle,
  IsolatedRuntimeActivationOptions,
  RuntimeActivationBindings,
  AgentRuntimeFactoryBindings,
} from './runtimeActivationBindings.js';

export {
  getCliStatelessHardeningPreference,
  isCliStatelessProviderModeEnabled,
} from './statelessHardening.js';
export type { StatelessHardeningPreference } from './statelessHardening.js';

export { validateRuntimeId } from './runtimeIdValidation.js';

export {
  getActiveModelName,
  listAvailableModels,
  getActiveProviderMetrics,
  getSessionTokenUsage,
  getUnallowedParametersForActiveModel,
  listProviders,
  getActiveProviderName,
  NO_ACTIVE_PROVIDER_ERROR_MESSAGE,
} from './providerReadOperations.js';
export {
  getEphemeralSettings,
  getEphemeralSetting,
  setEphemeralSetting,
  clearEphemeralSetting,
  getSessionSetting,
  setSessionSetting,
  clearSessionSetting,
} from './ownerSettingsOperations.js';
export {
  getActiveModelParams,
  setActiveModelParam,
  clearActiveModelParam,
} from './providerModelParameters.js';
export { readProviderStatus } from './providerStatus.js';
export type { ProviderRuntimeStatus } from './providerStatus.js';

export { activateIsolatedRuntimeContext } from './runtimeLifecycle.js';
export { beginCliRuntimeRegistration } from './cliForegroundRuntime.js';
export type { CliRuntimeRegistrationHandle } from './cliForegroundRuntime.js';

export { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
export type {
  AssembleCliProviderRuntimeInput,
  AssembledCliProviderRuntime,
} from './assembleCliProviderRuntime.js';

export {
  switchActiveProvider,
  DEFAULT_PRESERVE_EPHEMERALS,
} from './providerSwitch.js';
export type {
  ProviderSwitchResult,
  ProviderSwitchOptions,
  ProviderSwitcher,
} from './providerSwitch.js';

export {
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  getActiveToolFormatState,
  setActiveToolFormatOverride,
  setActiveModel,
} from './providerMutations.js';
export type {
  ApiKeyUpdateResult,
  BaseUrlUpdateResult,
  ToolFormatState,
  ToolFormatOverrideLiteral,
  ModelChangeResult,
} from './providerMutations.js';

export {
  applyCliArgumentOverrides,
  resolveNamedKey,
} from './settingsResolver.js';

// Ephemeral-setting helpers (re-exported so command surfaces reach them via
// the public runtime.js barrel instead of the deep ephemeralSettings path).
export {
  ephemeralSettingHelp,
  parseEphemeralSettingValue,
  isValidEphemeralSetting,
} from './ephemeralSettings.js';
export type {
  EphemeralSettingKey,
  EphemeralParseResult,
  EphemeralParseSuccess,
  EphemeralParseFailure,
} from './ephemeralSettings.js';

// CLI ephemeral-setting application (re-exported so the config bootstrap
// reaches it via the public runtime.js barrel).
export { applyCliSetArguments } from './cliEphemeralSettings.js';
export type {
  EphemeralSettingTarget,
  CliSetResult,
} from './cliEphemeralSettings.js';

// Provider config utilities (re-exported so the zed/ACP integration and other
// bootstrap clients reach them via the public runtime.js barrel).
export {
  setProviderApiKey,
  setProviderBaseUrl,
} from './providerConfigUtils.js';
export type { ProviderConfigResult } from './providerConfigUtils.js';

export {
  PROFILE_EPHEMERAL_KEYS,
  buildRuntimeProfileSnapshot,
  finishProfileApplication,
  saveProfileSnapshot,
  saveLoadBalancerProfile,
  deleteProfileByName,
  listSavedProfiles,
  getProfileByName,
} from './profileSnapshot.js';
export type {
  ProfileLoadOptions,
  ProfileLoadResult,
  RuntimeDiagnosticsSnapshot,
} from './profileSnapshot.js';
