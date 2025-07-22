/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider, IModel } from './index.js';

export class ProviderManager {
  private providers: Map<string, IProvider>;
  private activeProviderName: string;

  constructor() {
    this.providers = new Map<string, IProvider>();
    this.activeProviderName = ''; // No default provider
  }

  registerProvider(provider: IProvider): void {
    this.providers.set(provider.name, provider);

    // If this is the default provider and no provider is active, set it as active
    if (provider.isDefault && !this.activeProviderName) {
      this.activeProviderName = provider.name;
    }
  }

  setActiveProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error('Provider not found');
    }
    
    // Clear state from ALL providers before switching
    for (const provider of this.providers.values()) {
      if (provider.clearState) {
        provider.clearState();
      }
    }
    
    this.activeProviderName = name;
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
}
