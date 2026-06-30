/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thin compatibility coordinator for runtime APIs.
 *
 * New runtime code should import from focused modules:
 * - runtimeAccessors.ts
 * - runtimeLifecycle.ts
 * - providerSwitch.ts
 * - providerMutations.ts
 * - settingsResolver.ts
 * - profileSnapshot.ts
 */

import {
  createIsolatedRuntimeContext as createIsolatedRuntimeContextInternal,
  registerIsolatedRuntimeBindings,
} from './runtimeContextFactory.js';
import {
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  setCliRuntimeContext,
} from './runtimeLifecycle.js';
import { disposeCliRuntime } from './runtimeRegistry.js';
import { createProviderKeyStorage } from '../auth/index.js';
import { configureProviderRuntimeFactories } from '../composition/index.js';

export { createProviderKeyStorage };

export { createIsolatedRuntimeContextInternal as createIsolatedRuntimeContext };
export type {
  IsolatedRuntimeActivationOptions,
  IsolatedRuntimeContextHandle,
  IsolatedRuntimeContextOptions,
} from './runtimeContextFactory.js';

export {
  registerAgentRuntimeFactories,
  resetAgentRuntimeFactories,
} from './runtimeContextFactory.js';
export type { AgentRuntimeFactoryBindings } from './runtimeContextFactory.js';

// Runtime async-scope helpers (re-exported so consumers reach them via the
// public runtime.js barrel instead of the deep runtimeContextFactory path).
export {
  enterRuntimeScope,
  runWithRuntimeScope,
  getCurrentRuntimeScope,
} from './runtimeContextFactory.js';
export type { RuntimeScopeValue } from './runtimeContextFactory.js';

export {
  getLoadBalancerStats,
  getLoadBalancerLastSelected,
  getAllLoadBalancerStats,
} from './profileApplication.js';

export {
  configureCliStatelessHardening,
  getCliStatelessHardeningOverride,
  getCliStatelessHardeningPreference,
  isCliStatelessProviderModeEnabled,
} from './statelessHardening.js';
export type { StatelessHardeningPreference } from './statelessHardening.js';

export { resetCliRuntimeRegistryForTesting } from './runtimeRegistry.js';

export {
  getCliRuntimeContext,
  getCliRuntimeServices,
  getCliProviderManager,
  isCliRuntimeStatelessReady,
  ensureStatelessProviderReady,
  getCliOAuthManager,
  getCliRuntimeConfig,
  getActiveModelName,
  getActiveProviderStatus,
  listAvailableModels,
  getActiveProviderMetrics,
  getSessionTokenUsage,
  getEphemeralSettings,
  getEphemeralSetting,
  setEphemeralSetting,
  clearEphemeralSetting,
  getActiveModelParams,
  setActiveModelParam,
  clearActiveModelParam,
  listProviders,
  getActiveProviderName,
} from './runtimeAccessors.js';
export type {
  CliRuntimeServices,
  ProviderRuntimeStatus,
} from './runtimeAccessors.js';

export {
  activateIsolatedRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  setCliRuntimeContext,
} from './runtimeLifecycle.js';

export {
  switchActiveProvider,
  DEFAULT_PRESERVE_EPHEMERALS,
} from './providerSwitch.js';
export type { ProviderSwitchResult } from './providerSwitch.js';

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
  applyProfileSnapshot,
  saveProfileSnapshot,
  saveLoadBalancerProfile,
  loadProfileByName,
  deleteProfileByName,
  listSavedProfiles,
  getProfileByName,
  getActiveProfileName,
  setDefaultProfileName,
  getRuntimeDiagnosticsSnapshot,
} from './profileSnapshot.js';
export type {
  ProfileLoadOptions,
  ProfileLoadResult,
  RuntimeDiagnosticsSnapshot,
} from './profileSnapshot.js';

registerIsolatedRuntimeBindings({
  resetInfrastructure: resetCliProviderInfrastructure,
  setRuntimeContext: setCliRuntimeContext,
  registerInfrastructure: registerCliProviderInfrastructure,
  linkProviderManager: (config, manager) => {
    configureProviderRuntimeFactories(config, manager);
  },
  disposeRuntime: disposeCliRuntime,
});
