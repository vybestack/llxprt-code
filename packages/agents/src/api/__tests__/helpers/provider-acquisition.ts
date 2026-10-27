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
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  createSessionAuthPolicyReader,
  createOAuthProfileReads,
} from '@vybestack/llxprt-code-providers/composition.js';
import type {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  acquireRuntimeOAuth,
  acquireRuntimeProviderManager,
} from '../../provider-runtime-acquisition.js';

/** Staged construction for tests that exercise the manager before OAuth exists. */
export function acquirePreferredProviderManager(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  files: ProviderFileLifecycle,
  runtimeId: string,
  authority: CredentialAuthority,
  release: AcquisitionRelease,
): ProviderManager {
  return acquireRuntimeProviderManager(release, {
    config,
    settings,
    settingsOwner,
    files,
    proxy: config.getProxy(),
    authority,
    context: createProviderRuntimeContext({
      runtimeId,
      runtimeKind: 'agent',
      metadata: { source: 'cli-isolated-runtime-factory' },
    }),
  });
}

/** Completes a staged test acquisition with the selected token-store ownership. */
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
  return acquireRuntimeOAuth(release, {
    provider: {
      getProviderByName: (name) => manager.getProviderByName(name),
      fetchNetwork: (input, init) => manager.fetchNetwork(input, init),
      getAuthIdentity: () => manager.getAuthIdentity(),
    },
    readPolicy: createSessionAuthPolicyReader(settings),
    authority,
    oauth: {
      suppliedStore,
      readSettings: () =>
        oauthSettings === undefined
          ? createFileOAuthSettingsProvider()
          : (oauthSettings ?? undefined),
      messageBus,
      profileReads:
        profileReads ?? createOAuthProfileReads(config.profileDirectory),
      readIdentity: () => ({ runtimeId, runtimeKind: 'agent' }),
      requestInteractiveAuth: undefined,
    },
  });
}
