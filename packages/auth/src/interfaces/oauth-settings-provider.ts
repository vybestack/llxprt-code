/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow interface abstracting the settings access that the OAuth manager (and
 * provider usage queries) need.
 *
 * This interface is introduced in Phase 1 as a UI/settings-agnostic seam so the
 * OAuth manager can eventually move into `@vybestack/llxprt-code-auth` (Phase 2)
 * without depending on the CLI's `LoadedSettings` type.
 *
 * The method shapes mirror exactly how the CLI currently reads settings:
 * - {@link isOAuthEnabled} → `merged.oauthEnabledProviders?.[provider]` (see
 *   `provider-registry.ts` `isOAuthEnabled`).
 * - {@link getProviderApiKey} → `merged.providerApiKeys?.[provider]`.
 * - {@link getProviderKeyfile} → `merged.providerKeyfiles?.[provider]`.
 * - {@link getProviderBaseUrl} → `merged.providerBaseUrls?.[provider]` (used by
 *   `getHigherPriorityAuth` for the qwen/openai base-url mismatch check).
 * - {@link getOAuthEnabledProviders} → `merged.oauthEnabledProviders`, a
 *   `Record<string, boolean>` so callers can distinguish "explicitly disabled"
 *   (`false`) from "absent" (key missing) — exactly what `provider-registry.ts`
 *   relies on via `oauthEnabledProviders[providerName] ?? false`.
 *
 * Phase 1 only DEFINES this interface; the OAuth manager still accepts
 * `LoadedSettings`. Phase 2 will adopt it.
 */
export interface IOAuthSettingsProvider {
  /** Whether OAuth is enabled for the given provider. */
  isOAuthEnabled(provider: string): boolean;

  /** The API key configured for the provider, if any. */
  getProviderApiKey(provider: string): string | undefined;

  /** The path to the keyfile configured for the provider, if any. */
  getProviderKeyfile(provider: string): string | undefined;

  /** The base URL configured for the provider, if any. */
  getProviderBaseUrl(provider: string): string | undefined;

  /**
   * Map of all providers with explicit OAuth enablement state.
   *
   * Returns `Record<string, boolean>` (mirroring
   * `LoadedSettings.getOAuthEnabledProviders()`) so consumers can tell
   * "explicitly disabled" (`false`) apart from "no entry" (key absent) —
   * the distinction `provider-registry.ts` depends on.
   */
  getOAuthEnabledProviders(): Record<string, boolean>;

  /**
   * Persist OAuth enablement state for a provider.
   *
   * Mirrors the CLI's
   * `settings.setValue(SettingScope.User, 'oauthEnabledProviders', merged)`
   * call that `provider-registry.ts` previously made directly. Implementations
   * should read the current map, apply the single-provider override, and write
   * the result back.
   *
   * Added in Phase 2a so the relocated OAuth cluster can persist enablement
   * without depending on `LoadedSettings`.
   */
  setOAuthEnabled(provider: string, enabled: boolean): void;
}
