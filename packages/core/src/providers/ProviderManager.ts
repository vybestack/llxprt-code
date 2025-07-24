/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider } from './IProvider.js';
import { IModel } from './IModel.js';
import { IProviderManager } from './IProviderManager.js';

export class ProviderManager implements IProviderManager {
  private providers: Map<string, IProvider>;
  private activeProviderName: string;
  private serverToolsProvider: IProvider | null;

  constructor() {
    this.providers = new Map<string, IProvider>();
    this.activeProviderName = ''; // No default provider
    this.serverToolsProvider = null;
  }

  registerProvider(provider: IProvider): void {
    this.providers.set(provider.name, provider);

    // If this is the default provider and no provider is active, set it as active
    if (provider.isDefault && !this.activeProviderName) {
      this.activeProviderName = provider.name;
    }

    // If registering Gemini and we don't have a serverToolsProvider, use it
    if (provider.name === 'gemini' && !this.serverToolsProvider) {
      this.serverToolsProvider = provider;
    }

    // If Gemini is the active provider, it should also be the serverToolsProvider
    if (provider.name === 'gemini' && this.activeProviderName === 'gemini') {
      this.serverToolsProvider = provider;
    }
  }

  setActiveProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error('Provider not found');
    }

    // Store reference to the current active provider before switching
    const previousProviderName = this.activeProviderName;

    // Only clear state from the provider we're switching FROM
    // BUT never clear the serverToolsProvider's state
    if (previousProviderName && previousProviderName !== name) {
      const previousProvider = this.providers.get(previousProviderName);
      if (previousProvider && previousProvider.clearState) {
        // Don't clear state if this provider is also the serverToolsProvider
        if (previousProvider !== this.serverToolsProvider) {
          previousProvider.clearState();
        }
      }
    }

    this.activeProviderName = name;

    // If switching to Gemini, use it as both active and serverTools provider
    // BUT only if we don't already have a Gemini serverToolsProvider with auth state
    if (name === 'gemini') {
      // Only replace serverToolsProvider if it's not already Gemini or if it's null
      if (
        !this.serverToolsProvider ||
        this.serverToolsProvider.name !== 'gemini'
      ) {
        this.serverToolsProvider = this.providers.get(name) || null;
      }
    }
    // If switching away from Gemini but serverToolsProvider is not set,
    // configure a Gemini provider for serverTools if available
    else if (!this.serverToolsProvider && this.providers.has('gemini')) {
      this.serverToolsProvider = this.providers.get('gemini') || null;
    }
  }

  clearActiveProvider(): void {
    this.activeProviderName = '';
  }

  getActiveProvider(): IProvider {
    if (!this.activeProviderName) {
      throw new Error('No active provider set');
    }
    const provider = this.providers.get(this.activeProviderName);
    if (!provider) {
      throw new Error('Active provider not found');
    }
    return provider;
  }

  async getAvailableModels(providerName?: string): Promise<IModel[]> {
    let provider: IProvider | undefined;

    if (providerName) {
      provider = this.providers.get(providerName);
      if (!provider) {
        throw new Error(`Provider '${providerName}' not found`);
      }
    } else {
      provider = this.getActiveProvider();
    }

    return provider.getModels();
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  getActiveProviderName(): string {
    return this.activeProviderName;
  }

  hasActiveProvider(): boolean {
    return (
      this.activeProviderName !== '' &&
      this.providers.has(this.activeProviderName)
    );
  }

  getServerToolsProvider(): IProvider | null {
    // If we have a configured serverToolsProvider, return it
    if (this.serverToolsProvider) {
      return this.serverToolsProvider;
    }

    // Otherwise, try to get Gemini if available
    const geminiProvider = this.providers.get('gemini');
    if (geminiProvider) {
      this.serverToolsProvider = geminiProvider;
      return geminiProvider;
    }

    return null;
  }

  setServerToolsProvider(provider: IProvider | null): void {
    this.serverToolsProvider = provider;
  }
}
