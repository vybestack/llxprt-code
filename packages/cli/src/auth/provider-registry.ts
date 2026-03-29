/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { OAuthProvider } from './types.js';
import { type LoadedSettings, SettingScope } from '../config/settings.js';

const logger = new DebugLogger('llxprt:oauth:registry');

/**
 * ProviderRegistry manages OAuth provider registration and OAuth enablement state.
 * It owns the providers map and in-memory OAuth state, delegating to settings
 * when available for persistence.
 */
export class ProviderRegistry {
  private providers: Map<string, OAuthProvider> = new Map();
  private inMemoryOAuthState: Map<string, boolean> = new Map();

  constructor(private settings?: LoadedSettings) {}

  /**
   * Register an OAuth provider with the registry
   * @param provider - The OAuth provider to register
   */
  registerProvider(provider: OAuthProvider): void {
    if (!provider) {
      throw new Error('Provider cannot be null or undefined');
    }

    if (!provider.name || typeof provider.name !== 'string') {
      throw new Error('Provider must have a valid name');
    }

    // Validate provider has required methods
    if (typeof provider.initiateAuth !== 'function') {
      throw new Error('Provider must implement initiateAuth method');
    }

    if (typeof provider.getToken !== 'function') {
      throw new Error('Provider must implement getToken method');
    }

    if (typeof provider.refreshToken !== 'function') {
      throw new Error('Provider must implement refreshToken method');
    }

    this.providers.set(provider.name, provider);
    logger.debug(`Registered OAuth provider: ${provider.name}`);
  }

  /**
   * Get a registered OAuth provider
   * @param name - Provider name
   * @returns OAuth provider or undefined if not registered
   */
  getProvider(name: string): OAuthProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get list of all registered provider names
   * @returns Array of provider names sorted alphabetically
   */
  getSupportedProviders(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  /**
   * Toggle OAuth enablement for a provider
   * @param providerName - Name of the provider
   * @returns New enablement state (true if enabled, false if disabled)
   */
  toggleOAuthEnabled(providerName: string): boolean {
    if (!providerName || typeof providerName !== 'string') {
      throw new Error('Provider name must be a non-empty string');
    }

    const provider = this.providers.get(providerName);
    if (provider == null) {
      throw new Error(`Unknown provider: ${providerName}`);
    }

    const currentlyEnabled = this.isOAuthEnabled(providerName);
    const newState = !currentlyEnabled;

    this.setOAuthEnabledState(providerName, newState);

    logger.debug(
      `Toggled OAuth for ${providerName}: ${currentlyEnabled} -> ${newState}`,
    );

    return newState;
  }

  /**
   * Check if OAuth is enabled for a provider
   * @param providerName - Name of the provider
   * @returns True if OAuth is enabled, false otherwise
   */
  isOAuthEnabled(providerName: string): boolean {
    // In-memory state takes precedence when explicitly set
    if (this.inMemoryOAuthState.has(providerName)) {
      return this.inMemoryOAuthState.get(providerName) ?? false;
    }

    if (this.settings != null) {
      // Check settings if available
      const oauthEnabledProviders =
        this.settings.merged.oauthEnabledProviders || {};
      return oauthEnabledProviders[providerName] ?? false;
    }

    // Default to false when no settings and no in-memory state
    return false;
  }

  /**
   * Set OAuth enabled state for a provider
   * Persists to settings if available, otherwise stores in-memory
   * @param providerName - Name of the provider
   * @param enabled - Whether OAuth is enabled
   */
  setOAuthEnabledState(providerName: string, enabled: boolean): void {
    // Always update in-memory state for precedence
    this.inMemoryOAuthState.set(providerName, enabled);

    if (this.settings != null) {
      const oauthEnabledProviders = {
        ...(this.settings.merged.oauthEnabledProviders || {}),
      };
      oauthEnabledProviders[providerName] = enabled;
      this.settings.setValue(
        SettingScope.User,
        'oauthEnabledProviders',
        oauthEnabledProviders,
      );
    }

    logger.debug(`Set OAuth state for ${providerName}: ${enabled}`);
  }

  /**
   * Check if there is an explicit in-memory OAuth state for a provider
   * This is used to distinguish between "no state" (default) and "explicitly disabled"
   * @param providerName - Name of the provider
   * @returns True if in-memory state has been explicitly set
   */
  hasExplicitInMemoryOAuthState(providerName: string): boolean {
    return this.inMemoryOAuthState.has(providerName);
  }
}
