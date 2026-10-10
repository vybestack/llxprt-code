/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readInvocationPolicyRecord } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { captureInvocationEphemerals } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { AuthPrecedenceResolver } from '@vybestack/llxprt-code-auth/precedence.js';

export function composeProviderOwner(
  providerName: string,
  settings: SettingsService,
  resolveAuth: () => AuthPrecedenceResolver,
): ProviderOwner {
  return {
    capturePolicy: () => {
      const global = settings.getAllGlobalSettings();
      return captureInvocationEphemerals({
        ...global,
        [providerName]: {
          ...readInvocationPolicyRecord(global[providerName]),
          ...settings.getProviderSettings(providerName),
        },
      });
    },
    captureAuthentication: () => {
      const resolver = resolveAuth();
      return (input) =>
        resolver.resolveAuthenticationResult({
          ...input,
          settingsService: settings,
        });
    },
    readAuthentication: (input) =>
      resolveAuth().resolveAuthenticationResult({
        ...input,
        settingsService: settings,
      }),
    readNonOAuthAuthentication: () =>
      resolveAuth().hasNonOAuthAuthentication({ settingsService: settings }),
    readOAuthOnly: () =>
      resolveAuth().isOAuthOnlyAvailable({ settingsService: settings }),
    readAuthMethodName: () =>
      resolveAuth().getAuthMethodName({ settingsService: settings }),
    clearAuthentication: () => {
      settings.set('auth-key', undefined);
      settings.set('auth-keyfile', undefined);
    },
    readProviderData: () => settings.getSettings(providerName),
    writeProviderData: (changes) =>
      settings.updateSettings(providerName, changes),
  };
}

export interface ProviderOwner {
  capturePolicy(): Readonly<Record<string, unknown>>;
  captureAuthentication(): ProviderOwner['readAuthentication'];
  readAuthentication(input: {
    includeOAuth: boolean;
    runtimeId?: string;
    profileId?: string;
    authIntent?: 'oauth' | 'apikey';
  }): ReturnType<AuthPrecedenceResolver['resolveAuthenticationResult']>;
  readNonOAuthAuthentication(): Promise<boolean>;
  readOAuthOnly(): Promise<boolean>;
  readAuthMethodName(): Promise<string | null>;
  clearAuthentication(): void;
  readProviderData(): Promise<Record<string, unknown>>;
  writeProviderData(changes: Record<string, unknown>): Promise<void>;
}
