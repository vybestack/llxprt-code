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

export {
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  setActiveModel,
} from './providerMutations.js';

export {
  applyCliArgumentOverrides,
  resolveNamedKey,
} from './settingsResolver.js';

// Provider config utilities (re-exported so the zed/ACP integration and other
// bootstrap clients reach them via the public runtime.js barrel).
export {
  setProviderApiKey,
  setProviderBaseUrl,
} from './providerConfigUtils.js';
export type { ProviderConfigResult } from './providerConfigUtils.js';
