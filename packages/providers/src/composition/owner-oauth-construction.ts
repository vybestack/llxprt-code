/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import type { OAuthFetch } from '@vybestack/llxprt-code-auth/types.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { InteractiveAuthPromptOperation } from '@vybestack/llxprt-code-core/runtime/contracts/InteractiveAuthPrompt.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import { OAuthManager } from '../auth/oauth-manager.js';
import type { SessionAuthPolicy, TokenStore } from '../auth/types.js';
import { registerStandardOAuthProviders } from './oauth-provider-registration.js';

export function createOwnerOAuthManager(
  tokenStore: TokenStore,
  oauthSettings: IOAuthSettingsProvider | undefined,
  messageBus: MessageBus,
  profileReads: Pick<ProfileManager, 'loadProfile'>,
  readSessionAuthPolicy: () => SessionAuthPolicy,
  readAuthIdentity: () => Pick<
    ProviderRuntimeContext,
    'runtimeId' | 'runtimeKind'
  >,
  requestInteractiveAuth: InteractiveAuthPromptOperation | undefined,
  invalidateAuthCaches: (providerName: string) => void,
  requestFetch: OAuthFetch,
): OAuthManager {
  const manager = new OAuthManager(tokenStore, oauthSettings, {
    messageBus,
    profileReads,
    readSessionAuthPolicy,
    readAuthIdentity,
    requestInteractiveAuth,
    invalidateAuthCaches,
  });
  registerStandardOAuthProviders(manager, requestFetch, tokenStore);
  return manager;
}
