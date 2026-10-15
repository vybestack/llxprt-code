/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import { registerProvidersOntoManager } from './policyComposition.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { applyRuntimeEphemerals } from './agentConfig.adapter.js';
import type { ParsedAgentConfig } from './config-schema.js';
import type { AgentRetainedProviderFile } from './provider-file-domain.js';
import { releaseAdoptedFileScope } from './adoption-release.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  TokenStore,
  IOAuthSettingsProvider,
} from '@vybestack/llxprt-code-auth';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  createOwnerOAuthManager,
  createOwnedTokenStoreClose,
  createSessionAuthPolicyReader,
  createOAuthProfileReads,
  createOwnerAuthCacheInvalidator,
} from '@vybestack/llxprt-code-providers/composition.js';

export function acquirePreferredSettings(
  config: Config,
  settings: SettingsService,
  parsed: ParsedAgentConfig,
  release: AcquisitionRelease,
): SessionSettingsOwner {
  const owner = new SessionSettingsOwner(settings);
  release.acquire('settings', () => owner.dispose());
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  owner.initializeProviderSelection(config.getProvider(), config.getModel());
  applyRuntimeEphemerals(
    {
      setEphemeralSetting: (key, value) => owner.writeUserParameter(key, value),
    },
    parsed,
  );
  owner.bindTelemetry(config, undefined);
  return owner;
}

export async function acquirePreferredFiles(
  config: Config,
  runtimeId: string,
  inputs: readonly AgentRetainedProviderFile[],
  release: AcquisitionRelease,
): Promise<ProviderFileLifecycle> {
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  for (const scope of runtimeId === config.getSessionId()
    ? [runtimeId]
    : [runtimeId, config.getSessionId()])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  for (const input of inputs) {
    const retained = await files.retain({ ...input, scopeId: runtimeId });
    await retained.lease.release();
  }
  return files;
}

export function acquirePreferredProviderManager(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  files: ProviderFileLifecycle,
  runtimeId: string,
  authority: CredentialAuthority,
  release: AcquisitionRelease,
): ProviderManager {
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    files,
    settings,
    config,
    createProviderRuntimeContext({
      runtimeId,
      runtimeKind: 'agent',
      metadata: { source: 'cli-isolated-runtime-factory' },
    }),
    undefined,
    settingsOwner,
  );
  release.acquire('manager', () => manager.dispose());
  const keys = authority.createProviderKeyStorage();
  release.acquire('manager', () => keys.close());
  manager.bindProviderKeyStorage(keys);
  return manager;
}

export function acquirePreferredOAuth(
  suppliedStore: TokenStore | undefined,
  messageBus: MessageBus,
  config: Config,
  settings: SettingsService,
  manager: ProviderManager,
  runtimeId: string,
  profileReads: Pick<ProfileManager, 'loadProfile'> | undefined,
  authority: CredentialAuthority,
  release: AcquisitionRelease,
  oauthSettings: IOAuthSettingsProvider | null | undefined,
): OAuthManager {
  const store = suppliedStore ?? authority.createTokenStore();
  if (suppliedStore === undefined)
    release.acquire('tokens', createOwnedTokenStoreClose(store));
  const selectedSettings =
    oauthSettings === undefined
      ? createFileOAuthSettingsProvider()
      : oauthSettings;
  const oauth = createOwnerOAuthManager(
    store,
    selectedSettings ?? undefined,
    messageBus,
    profileReads ?? createOAuthProfileReads(config.profileDirectory),
    createSessionAuthPolicyReader(settings),
    () => ({ runtimeId, runtimeKind: 'agent' }),
    undefined,
    createOwnerAuthCacheInvalidator((name) => manager.getProviderByName(name)),
    (input, init) => manager.fetchNetwork(input, init),
  );
  release.acquire('oauth', () => oauth.dispose());
  return oauth;
}

export async function preparePreferredProviderCompletion(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: ProviderManager,
  oauth: OAuthManager,
  runtimeId: string,
  tokenizer: RuntimeTokenizerFactory,
  contributions: ProviderContributionRegistry | undefined,
): Promise<void> {
  await settingsOwner.startTelemetry(config);
  manager.setRetryOperationsFactory((name, profileId) =>
    oauth.composeRetryOperations(name, profileId ? { profileId } : undefined),
  );
  manager.setRuntimeContext(
    createProviderRuntimeContext({
      runtimeId,
      runtimeKind: 'agent',
      metadata: { source: 'cli-isolated-runtime-factory' },
    }),
    settingsOwner,
    settings,
    config,
  );
  registerProvidersOntoManager(manager, settings, config, oauth, contributions);
  manager.setTokenizerFactory(tokenizer);
  manager.setConfig(config);
}
