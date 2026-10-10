/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { OAuthManager } from '../auth/oauth-manager.js';
import {
  DebugLogger,
  type Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { OAuthUICallback } from '@vybestack/llxprt-code-auth';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { getProviderSettingsSnapshot } from './providerModelParameters.js';
import { extractProviderBaseUrl } from './providerMutations.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasConfig,
  ensureOAuthProviderRegistered,
  configureProviderRuntimeFactories,
} from '../composition/index.js';
import {
  executeProviderSwitch,
  type SwitchRequest,
  type SwitchEphemeralOperations,
  type SwitchActivationOperations,
} from './provider-switch-execution.js';
import type { SwitchOAuthOperations } from './provider-switch-oauth.js';

export { resolveLazyClaudeCodeOAuthDecision } from './provider-switch-oauth.js';

function logger(): DebugLogger {
  return new DebugLogger('llxprt:runtime:settings');
}

export const DEFAULT_PRESERVE_EPHEMERALS = [
  'context-limit',
  'max_tokens',
  'streaming',
] as const;

export interface ProviderSwitchResult {
  changed: boolean;
  previousProvider: string | null;
  nextProvider: string;
  defaultModel?: string;
  infoMessages: string[];
}

export interface ProviderSwitchOptions {
  publication?: 'immediate' | 'deferred';
  clientReplacement?: 'immediate' | 'deferred';
  autoOAuth?: boolean;
  preserveEphemerals?: string[];
  skipModelDefaults?: boolean;
  addItem?: OAuthUICallback;
}

export type ProviderSwitcher = (
  name: string,
  options?: ProviderSwitchOptions,
) => Promise<ProviderSwitchResult>;

function getAliasConfig(providerName: string): ProviderAliasConfig | undefined {
  try {
    const alias = loadProviderAliasEntries().find(
      (entry) => entry.alias === providerName,
    )?.config;
    return alias === undefined ? undefined : structuredClone(alias);
  } catch {
    return undefined;
  }
}

function hasNonOAuthAuthentication(
  provider: unknown,
): provider is { hasNonOAuthAuthentication(): Promise<boolean> } {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'hasNonOAuthAuthentication' in provider &&
    typeof provider.hasNonOAuthAuthentication === 'function'
  );
}

function nonOAuthAuthentication(provider: unknown): () => Promise<boolean> {
  const visited = new Set<unknown>();
  let current = provider;
  while (
    typeof current === 'object' &&
    current !== null &&
    'wrappedProvider' in current &&
    current.wrappedProvider != null
  ) {
    if (visited.has(current)) throw new Error('Cyclic provider wrapper');
    visited.add(current);
    current = current.wrappedProvider;
  }
  return hasNonOAuthAuthentication(current)
    ? current.hasNonOAuthAuthentication.bind(current)
    : async () => true;
}

function switchEphemeralOperations(
  owner: SessionSettingsOwner,
): SwitchEphemeralOperations {
  return {
    getEphemeralSetting: owner.readNamedParameter.bind(owner),
    setEphemeralSetting: owner.writeNamedParameter.bind(owner),
    getEphemeralSettings: owner.captureNamedParameters.bind(owner),
    isEphemeralUserOwned: owner.isUserParameter.bind(owner),
    recordProviderDefaultOwnedEntries: owner.recordProviderDefaults.bind(owner),
    recordModelDefaultOwnedKeys: owner.recordModelDefaults.bind(owner),
  };
}

function switchActivationOperations(
  config: Config,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  initializeClient: () => Promise<void>,
  owner: SessionSettingsOwner,
): SwitchActivationOperations {
  return {
    resetFailover: () => oauth?.clearRetryHandlers(),
    activate: async (name) => {
      await manager.setActiveProvider(name);
      configureProviderRuntimeFactories(config, manager);
      return manager.getActiveProvider()?.getDefaultModel?.();
    },
    setModel: owner.chooseModel.bind(owner),
    getModel: () => owner.readSelectedModel() ?? '',
    initialize: initializeClient,
  };
}

function switchOAuthOperations(
  oauth: OAuthManager | null,
  addItem: OAuthUICallback | undefined,
): SwitchOAuthOperations | null {
  if (oauth === null) return null;
  return {
    register: () =>
      ensureOAuthProviderRegistered('claudecode', oauth, undefined, addItem),
    isEnabled: () => oauth.isOAuthEnabled('claudecode'),
    enable: async () => {
      await oauth.toggleOAuthEnabled('claudecode');
    },
    authenticate: async () => {
      await oauth.authenticate('claudecode', undefined, {
        signalAuthCompletion: true,
      });
    },
  };
}

function captureSwitchRequest(
  name: string,
  currentProvider: string | null,
  options: ProviderSwitchOptions,
  owner: SessionSettingsOwner,
  settingsService: SettingsService,
  target: unknown,
): SwitchRequest {
  return Object.freeze({
    name,
    currentProvider,
    skipModelDefaults: options.skipModelDefaults ?? false,
    preserveEphemerals: Object.freeze([
      ...DEFAULT_PRESERVE_EPHEMERALS,
      ...(options.preserveEphemerals ?? []),
    ]),
    publication: options.publication,
    clientReplacement: options.clientReplacement,
    alias: getAliasConfig(name),
    providerBaseUrl:
      name === 'qwen'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : extractProviderBaseUrl(target),
    previousEphemerals: Object.freeze(
      structuredClone(owner.captureNamedParameters()),
    ),
    previousSettings: Object.freeze(
      currentProvider === null
        ? {}
        : structuredClone(
            getProviderSettingsSnapshot(settingsService, currentProvider),
          ),
    ),
    targetSettings: Object.freeze(
      structuredClone(getProviderSettingsSnapshot(settingsService, name)),
    ),
  });
}

export async function switchActiveProvider(
  providerName: string,
  options: ProviderSwitchOptions,
  config: Config,
  settingsService: SettingsService,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager | null,
  runtimeKind: RuntimeKind | undefined,
  initializeClient: () => Promise<void>,
  owner: SessionSettingsOwner,
): Promise<ProviderSwitchResult> {
  const name = providerName.trim();
  if (!name) throw new Error('Provider name is required.');
  if (
    [config, settingsService, providerManager, oauthManager].some(
      (dependency: unknown) => dependency === undefined,
    )
  )
    throw new Error(
      'Provider switch requires explicit config, settings, provider manager and OAuth ownership (null when disabled).',
    );
  const target = providerManager.getProviderByName(name);
  if (!target) throw new Error(`Provider '${name}' not found`);
  const currentProvider = providerManager.getActiveProviderName() ?? null;
  if (currentProvider === name)
    return {
      changed: false,
      previousProvider: currentProvider,
      nextProvider: name,
      infoMessages: [],
    };
  const request = captureSwitchRequest(
    name,
    currentProvider,
    options,
    owner,
    settingsService,
    target,
  );
  const oauth =
    name === 'claudecode'
      ? switchOAuthOperations(oauthManager, options.addItem)
      : null;
  const oauthPolicy = Object.freeze({
    explicitAutoOAuth: options.autoOAuth,
    isInteractive:
      name === 'claudecode' && options.autoOAuth === undefined && oauth !== null
        ? config.isInteractive()
        : false,
    runtimeKind,
  });
  const switchLogger = logger();
  switchLogger.debug(
    () =>
      `[cli-runtime] Switching provider from ${currentProvider ?? 'none'} to ${name}`,
  );
  return executeProviderSwitch(
    request,
    switchEphemeralOperations(owner),
    {
      setProviderSetting:
        settingsService.setProviderSetting.bind(settingsService),
      getCurrentProfileName:
        settingsService.getCurrentProfileName.bind(settingsService),
    },
    switchActivationOperations(
      config,
      providerManager,
      oauthManager,
      initializeClient,
      owner,
    ),
    oauth,
    oauthPolicy,
    nonOAuthAuthentication(target),
    switchLogger.warn.bind(switchLogger),
  );
}
