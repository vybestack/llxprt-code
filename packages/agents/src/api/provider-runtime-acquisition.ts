/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  IOAuthSettingsProvider,
  TokenStore,
} from '@vybestack/llxprt-code-auth';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  createOwnedTokenStoreClose,
  createOwnerAuthCacheInvalidator,
  createOwnerOAuthManager,
  createSessionAuthPolicyReader,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { releaseAdoptedFileScope } from './adoption-release.js';
import { acquireRootNetwork } from './root-network.js';

interface ProviderManagerInputs {
  readonly files: ProviderFileLifecycle;
  readonly proxy: string | undefined;
  readonly settings: SettingsService;
  readonly config: Config | undefined;
  readonly settingsOwner: SessionSettingsOwner | undefined;
  readonly context: ProviderRuntimeContext;
  readonly authority: Pick<CredentialAuthority, 'createProviderKeyStorage'>;
}

export interface ProviderOAuthInputs {
  readonly suppliedStore: TokenStore | undefined;
  readonly readSettings: () => IOAuthSettingsProvider | undefined;
  readonly messageBus: MessageBus;
  readonly profileReads: Parameters<typeof createOwnerOAuthManager>[3];
  readonly readIdentity: (
    manager: Pick<ProviderManager, 'getAuthIdentity'>,
  ) => ReturnType<ProviderManager['getAuthIdentity']>;
  readonly requestInteractiveAuth: Parameters<
    typeof createOwnerOAuthManager
  >[6];
}

interface OAuthAcquisitionInputs {
  readonly provider: Pick<
    ProviderManager,
    'getProviderByName' | 'fetchNetwork' | 'getAuthIdentity'
  >;
  readonly readPolicy: Parameters<typeof createOwnerOAuthManager>[4];
  readonly authority: Pick<CredentialAuthority, 'createTokenStore'>;
  readonly oauth: ProviderOAuthInputs;
}

export function acquireProviderFiles(
  release: AcquisitionRelease,
  inputs: {
    readonly proxy: string | undefined;
    readonly scopeIds: readonly string[];
  },
): ProviderFileLifecycle {
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
    proxy: inputs.proxy,
  });
  for (const scope of new Set(inputs.scopeIds))
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  return files;
}

export function acquireRuntimeProviderManager(
  release: AcquisitionRelease,
  inputs: ProviderManagerInputs,
): ProviderManager {
  const network = acquireRootNetwork(release, inputs.proxy);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    inputs.files,
    inputs.settings,
    inputs.config,
    inputs.context,
    undefined,
    inputs.settingsOwner,
  );
  manager.bindNetworkFetch(network.fetch);
  release.acquire('manager', () => manager.dispose());
  const keys = inputs.authority.createProviderKeyStorage();
  release.acquire('manager', () => keys.close());
  manager.bindProviderKeyStorage(keys);
  return manager;
}

export function acquireRuntimeOAuth(
  release: AcquisitionRelease,
  inputs: OAuthAcquisitionInputs,
): OAuthManager {
  const { provider, oauth: selection } = inputs;
  const tokens = selection.suppliedStore ?? inputs.authority.createTokenStore();
  if (selection.suppliedStore === undefined)
    release.acquire('tokens', createOwnedTokenStoreClose(tokens));
  const oauth = createOwnerOAuthManager(
    tokens,
    selection.readSettings(),
    selection.messageBus,
    selection.profileReads,
    inputs.readPolicy,
    () => selection.readIdentity(provider),
    selection.requestInteractiveAuth,
    createOwnerAuthCacheInvalidator((name) => provider.getProviderByName(name)),
    (input, init) => provider.fetchNetwork(input, init),
  );
  release.acquire('oauth', () => oauth.dispose());
  return oauth;
}

export function acquireProviderRuntime(
  release: AcquisitionRelease,
  inputs: ProviderManagerInputs & {
    readonly authority: Pick<
      CredentialAuthority,
      'createProviderKeyStorage' | 'createTokenStore'
    >;
  },
  selection: ProviderOAuthInputs,
  publishOAuth: (oauth: OAuthManager) => void,
): ProviderManager {
  const manager = acquireRuntimeProviderManager(release, inputs);
  const oauth = acquireRuntimeOAuth(release, {
    provider: {
      getProviderByName: (name) => manager.getProviderByName(name),
      fetchNetwork: (input, init) => manager.fetchNetwork(input, init),
      getAuthIdentity: () => manager.getAuthIdentity(),
    },
    readPolicy: createSessionAuthPolicyReader(inputs.settings),
    authority: inputs.authority,
    oauth: selection,
  });
  publishOAuth(oauth);
  return manager;
}

export function readProviderAuthIdentity(
  manager: Pick<ProviderManager, 'getAuthIdentity'>,
): ReturnType<ProviderManager['getAuthIdentity']> {
  return manager.getAuthIdentity();
}

export function retainOAuthSettings(
  settings: IOAuthSettingsProvider | undefined,
): () => IOAuthSettingsProvider | undefined {
  return () => settings;
}
