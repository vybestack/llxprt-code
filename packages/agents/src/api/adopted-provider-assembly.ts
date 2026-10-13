/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import {
  ProviderManager,
  type ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  type OAuthManager,
  type CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  populateProviderManager,
  NodeFileSystem,
  createOwnerOAuthManager,
  createSessionAuthPolicyReader,
  createOAuthProfileReads,
  createOwnedTokenStoreClose,
  createOwnerAuthCacheInvalidator,
  registerStandardOAuthProviders,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';

export function acquireAdoptedProviderManager(
  supplied: RuntimeProviderManager | undefined,
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  files: ProviderFileLifecycle,
  runtimeId: string,
  authority: CredentialAuthority,
  release: AcquisitionRelease,
): RuntimeProviderManager {
  if (supplied !== undefined) return supplied;
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    files,
    settings,
    config,
    adoptionProviderContext(runtimeId),
    undefined,
    settingsOwner,
  );
  release.acquire('manager', () => manager.dispose());
  const storage = authority.createProviderKeyStorage();
  release.acquire('manager', () => storage.close());
  manager.bindProviderKeyStorage(storage);
  return manager;
}

export function acquireAdoptedOAuth(
  supplied: OAuthManager | undefined,
  suppliedStore: TokenStore | undefined,
  messageBus: MessageBus,
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  runtimeId: string,
  profileReads: Pick<ProfileManager, 'loadProfile'> | undefined,
  authority: CredentialAuthority,
  release: AcquisitionRelease,
): OAuthManager {
  const requestFetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (manager.fetchNetwork === undefined)
      throw new Error('Provider manager requires root fetch');
    return manager.fetchNetwork(input, init);
  };
  if (supplied !== undefined) {
    registerStandardOAuthProviders(supplied, requestFetch);
    return supplied;
  }
  const store = suppliedStore ?? authority.createTokenStore();
  if (suppliedStore === undefined)
    release.acquire('tokens', createOwnedTokenStoreClose(store));
  const oauth = createOwnerOAuthManager(
    store,
    createFileOAuthSettingsProvider(),
    messageBus,
    profileReads ?? createOAuthProfileReads(config.profileDirectory),
    createSessionAuthPolicyReader(settings),
    () => ({ runtimeId, runtimeKind: 'agent' }),
    undefined,
    createOwnerAuthCacheInvalidator((name) => manager.getProviderByName(name)),
    requestFetch,
  );
  release.acquire('oauth', () => oauth.dispose());
  return oauth;
}

export async function activateAdoptedProviders(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  runtimeId: string,
  populate: boolean,
  tokenizerFactory: RuntimeTokenizerFactory,
): Promise<void> {
  await settingsOwner.startTelemetry(config);
  manager.setRetryOperationsFactory?.((providerName, profileId) =>
    oauth.composeRetryOperations(
      providerName,
      profileId ? { profileId } : undefined,
    ),
  );
  manager.setRuntimeContext(
    adoptionProviderContext(runtimeId),
    settingsOwner,
    settings,
    config,
  );
  if (populate) {
    if (!(manager instanceof ProviderManager))
      throw new Error(
        'Owned provider population requires its concrete manager',
      );
    populateProviderManager(
      manager,
      oauth,
      oauth.getTokenStore(),
      settings,
      new NodeFileSystem(),
      config,
      undefined,
      undefined,
      false,
      false,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
  }
  manager.setTokenizerFactory?.(tokenizerFactory);
  manager.setConfig(config);
}

function adoptionProviderContext(runtimeId: string) {
  return createProviderRuntimeContext({
    runtimeId,
    runtimeKind: 'agent',
    metadata: { source: 'cli-isolated-runtime-factory' },
  });
}
