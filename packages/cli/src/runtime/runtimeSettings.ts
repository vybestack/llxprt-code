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
import { createProviderKeyStorage } from '../auth/proxy/credential-store-factory.js';

export { createProviderKeyStorage };

export { createIsolatedRuntimeContextInternal as createIsolatedRuntimeContext };
export type {
  IsolatedRuntimeActivationOptions,
  IsolatedRuntimeContextHandle,
  IsolatedRuntimeContextOptions,
} from './runtimeContextFactory.js';

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
    config.setProviderManager(manager);
  },
  disposeRuntime: disposeCliRuntime,
});
