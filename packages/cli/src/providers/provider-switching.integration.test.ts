/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getProviderManager,
  resetProviderManager,
} from './providerManagerInstance';
import { IProvider } from './IProvider';

describe('Provider Switching Integration', () => {
  beforeEach(() => {
    resetProviderManager();
  });

  afterEach(() => {
    resetProviderManager();
  });

  it('should support switching between providers and back to Gemini', () => {
    const manager = getProviderManager();

    // Clear any auto-loaded active provider
    if (manager.hasActiveProvider()) {
      manager.clearActiveProvider();
    }

    // Now no active provider (Gemini is default)
    expect(manager.hasActiveProvider()).toBe(false);

    // Register a mock provider
    const mockProvider: IProvider = {
      name: 'test-provider',
      async getModels() {
        return [{ id: 'test-model', name: 'Test Model' }];
      },
      async *generateChatCompletion() {
        yield { role: 'assistant', content: 'test response' };
      },
    };

    manager.registerProvider(mockProvider);

    // Switch to the test provider
    manager.setActiveProvider('test-provider');
    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('test-provider');

    // Switch back to Gemini
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBe('');
  });

  it('should list gemini as an available option even when not registered', () => {
    const manager = getProviderManager();

    // Register some providers
    const provider1: IProvider = {
      name: 'provider1',
      async getModels() {
        return [];
      },
      async *generateChatCompletion() {
        yield { role: 'assistant', content: '' };
      },
    };

    const provider2: IProvider = {
      name: 'provider2',
      async getModels() {
        return [];
      },
      async *generateChatCompletion() {
        yield { role: 'assistant', content: '' };
      },
    };

    manager.registerProvider(provider1);
    manager.registerProvider(provider2);

    // List providers - should not include 'gemini' as it's not a registered provider
    const providers = manager.listProviders();
    // Filter out any auto-loaded providers like 'openai'
    const testProviders = providers.filter((p) => p.startsWith('provider'));
    expect(testProviders).toEqual(['provider1', 'provider2']);
    expect(providers).not.toContain('gemini');

    // But we can still clear to go back to Gemini
    manager.setActiveProvider('provider1');
    expect(manager.getActiveProviderName()).toBe('provider1');

    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
  });
});
