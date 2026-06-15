/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';

/**
 * Minimal settings shape used by tests to construct a fake
 * {@link IOAuthSettingsProvider}. Mirrors the fields the real
 * LoadedSettings.merged exposes that the OAuth cluster reads.
 */
export interface FakeOAuthSettingsData {
  oauthEnabledProviders?: Record<string, boolean>;
  providerApiKeys?: Record<string, string>;
  providerKeyfiles?: Record<string, string>;
  providerBaseUrls?: Record<string, string>;
}

/**
 * Create a real {@link IOAuthSettingsProvider} backed by a plain record.
 *
 * This replaces the previous `createLoadedSettings` helpers that constructed
 * a full CLI `LoadedSettings` — the OAuth cluster now consumes only the
 * narrow `IOAuthSettingsProvider` interface.
 */
export function createFakeOAuthSettings(
  data: FakeOAuthSettingsData = {},
): IOAuthSettingsProvider {
  const providers: Record<string, boolean> = {
    ...(data.oauthEnabledProviders ?? {}),
  };
  return {
    isOAuthEnabled: (provider: string) => providers[provider] ?? false,
    getProviderApiKey: (provider: string) => data.providerApiKeys?.[provider],
    getProviderKeyfile: (provider: string) => data.providerKeyfiles?.[provider],
    getProviderBaseUrl: (provider: string) => data.providerBaseUrls?.[provider],
    getOAuthEnabledProviders: () => providers,
    setOAuthEnabled: (provider: string, enabled: boolean) => {
      providers[provider] = enabled;
    },
  };
}
