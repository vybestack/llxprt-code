/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import { SettingScope, type LoadedSettings } from '../config/settings.js';

/**
 * CLI adapter that implements {@link IOAuthSettingsProvider} by delegating
 * to a {@link LoadedSettings} instance.
 *
 * This is the bridge between the CLI's `LoadedSettings` (which lives in the
 * CLI package) and the OAuth cluster in `@vybestack/llxprt-code-providers`
 * (which only knows the narrow `IOAuthSettingsProvider` interface).
 */
export class LoadedSettingsOAuthAdapter implements IOAuthSettingsProvider {
  constructor(private readonly settings: LoadedSettings) {}

  isOAuthEnabled(provider: string): boolean {
    return this.settings.merged.oauthEnabledProviders?.[provider] ?? false;
  }

  getProviderApiKey(provider: string): string | undefined {
    return this.settings.merged.providerApiKeys?.[provider];
  }

  getProviderKeyfile(provider: string): string | undefined {
    return this.settings.merged.providerKeyfiles?.[provider];
  }

  getProviderBaseUrl(provider: string): string | undefined {
    return this.settings.merged.providerBaseUrls?.[provider];
  }

  getOAuthEnabledProviders(): Record<string, boolean> {
    return this.settings.merged.oauthEnabledProviders ?? {};
  }

  setOAuthEnabled(provider: string, enabled: boolean): void {
    const merged = {
      ...(this.settings.merged.oauthEnabledProviders ?? {}),
    };
    merged[provider] = enabled;
    this.settings.setValue(SettingScope.User, 'oauthEnabledProviders', merged);
  }
}
