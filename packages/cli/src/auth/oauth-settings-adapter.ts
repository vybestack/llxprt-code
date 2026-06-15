/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import stripJsonComments from 'strip-json-comments';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import {
  LoadedSettings,
  SettingScope,
  type Settings,
} from '../config/settings.js';
import { USER_SETTINGS_PATH } from '../config/paths.js';

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

/**
 * Builds a {@link LoadedSettingsOAuthAdapter} from the user-scope settings file
 * on disk, returning `undefined` when no user settings exist.
 *
 * This preserves the exact construction that previously lived inside the
 * provider-composition factory (user-scope only, trusted) so that the OAuth
 * settings surface injected into `createProviderManager` is behavior-identical.
 */
export function createOAuthSettingsAdapter():
  | IOAuthSettingsProvider
  | undefined {
  let userSettings: Settings | undefined;
  try {
    if (fs.existsSync(USER_SETTINGS_PATH)) {
      const userContent = fs.readFileSync(USER_SETTINGS_PATH, 'utf-8');
      userSettings = JSON.parse(stripJsonComments(userContent)) as Settings;
    }
  } catch {
    // Failed to load user settings; fall back to no adapter (defaults).
  }

  if (!userSettings) {
    return undefined;
  }

  const loaded = new LoadedSettings(
    { path: '', settings: {} },
    { path: '', settings: {} },
    { path: USER_SETTINGS_PATH, settings: userSettings },
    { path: '', settings: {} },
    true,
  );

  return new LoadedSettingsOAuthAdapter(loaded);
}
