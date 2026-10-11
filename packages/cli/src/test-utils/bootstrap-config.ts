import type { BootstrapProfileArgs } from '../config/profileBootstrap.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AgentActivationOperation } from '@vybestack/llxprt-code-agents';
import type { loadCliConfig } from '../config/config.js';

export function handoffCliConfig(
  config: Config,
  createOperation: (
    store: SettingsService,
    owner: SessionSettingsOwner,
  ) => AgentActivationOperation,
  providerManager: RuntimeProviderManager,
): typeof loadCliConfig {
  return async (...args) => {
    const overrides = args[6];
    if (!overrides?.settingsService)
      throw new Error('Bootstrap fixture requires supplied settings store');
    const store = overrides.settingsService;
    const owner = overrides.sessionSettingsOwner;
    if (!owner) return config;
    owner.assertSettingsIdentity(store);
    providerManager.setRuntimeContext({ config, settingsService: store });
    owner.initializeProviderSelection(config.getProvider(), config.getModel());
    const operation = createOperation(store, owner);
    overrides.onProviderManagerReady?.(providerManager);
    overrides.onProviderSwitchReady?.(async (name) => ({
      changed: false,
      previousProvider: name,
      nextProvider: name,
      infoMessages: [],
    }));
    const policy = new RuntimePolicyOwner(config, operation.workspaceTrust);
    overrides.onPolicyOwnerReady?.(policy);
    if (operation.providerFileLifecycle === undefined)
      throw new Error('Bootstrap fixture requires its retained provider files');
    overrides.onProviderFilesReady?.(operation.providerFileLifecycle);
    overrides.onActivationBootstrapReady?.(operation);
    overrides.onProfileApplicationReady?.({
      isApplying: () => false,
      cancelAndJoin: async () => {},
      load: async () => {
        throw new Error('Unexpected profile load in bootstrap fixture');
      },
      applySnapshot: async () => {
        throw new Error('Unexpected profile application in bootstrap fixture');
      },
    });
    return config;
  };
}

export function makeBootstrapProfileArgs(
  overrides: Partial<BootstrapProfileArgs> = {},
): BootstrapProfileArgs {
  return {
    profileName: null,
    profileJson: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    keyNameOverride: null,
    baseurlOverride: null,
    setOverrides: null,
    debug: null,
    ...overrides,
  };
}
