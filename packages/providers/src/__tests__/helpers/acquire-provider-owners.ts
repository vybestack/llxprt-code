/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderContributionRegistry } from '../../composition/runtimePlugins/types.js';
import { NodeFileSystem } from '../../composition/IFileSystem.js';
import {
  createProviderPopulationTarget,
  populateProviderManager,
} from '../../composition/providerManagerInstance.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import type {
  TokenStore,
  IOAuthSettingsProvider,
} from '@vybestack/llxprt-code-auth';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../../ProviderManager.js';
import type { ProviderFileLifecycle } from '../../providerFilePolicy.js';
import type { CredentialAuthority } from '../../auth/proxy/credential-store-factory.js';
import { createFileOAuthSettingsProvider } from '../../auth/file-oauth-settings.js';
import type { OAuthManager } from '../../auth/oauth-manager.js';
import {
  createOwnedTokenStoreClose,
  createOwnerOAuthManager,
  createSessionAuthPolicyReader,
  createOAuthProfileReads,
  createOwnerAuthCacheInvalidator,
} from '../../composition/index.js';

/**
 * A `ProviderManager` wired the way a runtime owner wires one inside this
 * package: file lifecycle, network transport bound through a release, runtime
 * context and credential key storage. Providers composition tests use it so
 * they exercise their own owners instead of an external runtime's assembly.
 */
export function acquireOwnedProviderManager(
  config: Config,
  settings: SettingsService,
  settingsOwner: unknown,
  files: ProviderFileLifecycle,
  runtimeId: string,
  authority: CredentialAuthority,
  release: AcquisitionRelease,
  runtimeKind: RuntimeKind = 'agent',
): ProviderManager {
  const network = new OwnedFetch(config.getProxy());
  release.beforeRelease(() => network.closeAdmissionAndAbort());
  release.acquire('network', () => network.dispose());
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    files,
    settings,
    config,
    createProviderRuntimeContext({
      runtimeId,
      runtimeKind,
      metadata: { source: 'cli-isolated-runtime-factory' },
    }),
    undefined,
    settingsOwner as never,
  );
  manager.bindNetworkFetch(network.fetch);
  release.acquire('manager', () => manager.dispose());
  const keys = authority.createProviderKeyStorage();
  release.acquire('manager', () => keys.close());
  manager.bindProviderKeyStorage(keys);
  return manager;
}

/**
 * An `OAuthManager` owned by the same release as the provider manager above.
 */
export function acquireOwnedOAuth(
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
  runtimeKind: RuntimeKind = 'agent',
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
    () => ({ runtimeId, runtimeKind }),
    undefined,
    createOwnerAuthCacheInvalidator((name) => manager.getProviderByName(name)),
    (input, init) => manager.fetchNetwork(input, init),
  );
  release.acquire('oauth', () => oauth.dispose());
  return oauth;
}

/**
 * Completes an acquired manager/oauth pair the way an isolated runtime does:
 * telemetry, retry composition, runtime context, provider registration, the
 * tokenizer factory and the attached config.
 */
export async function prepareOwnedProviderCompletion(
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
  populateProviderManager({
    target: createProviderPopulationTarget(
      manager,
      oauth,
      oauth.getTokenStore(),
    ),
    readSetting: (key) => settings.get(key),
    fileSystem: new NodeFileSystem(),
    configuration: { kind: 'configured', config },
    contributions:
      contributions === undefined
        ? { kind: 'none' }
        : { kind: 'supplied', registry: contributions },
    messages: { kind: 'none' },
    allowBrowser: false,
    activateConfiguredProvider: false,
    fakeResponses:
      process.env.LLXPRT_FAKE_RESPONSES === undefined
        ? { kind: 'disabled' }
        : { kind: 'replay', path: process.env.LLXPRT_FAKE_RESPONSES },
  });
  manager.setTokenizerFactory(tokenizer);
  manager.setConfig(config);
}
