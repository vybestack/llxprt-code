/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from './ProviderManager.js';
import { IProvider } from './IProvider.js';
import { ContentGeneratorRole } from './ContentGeneratorRole.js';

describe('ProviderManager - Gemini switching', () => {
  let manager: ProviderManager;
  let mockProvider: IProvider;

  beforeEach(() => {
    manager = new ProviderManager();
    mockProvider = {
      name: 'openai',
      async getModels() {
        return [];
      },
      async *generateChatCompletion() {
        yield { role: ContentGeneratorRole.ASSISTANT, content: 'test' };
      },
      getServerTools: () => [],
      invokeServerTool: async () => {
        throw new Error('Server tools not supported');
      },
    };
  });

  it('should start with no active provider', () => {
    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBe('');
  });

  it('should allow clearing active provider to switch back to Gemini', () => {
    // Register and activate a provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('openai');
    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('openai');

    // Clear active provider (switch back to Gemini)
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBe('');
  });

  it('should correctly report hasActiveProvider state', () => {
    // Initially no active provider
    expect(manager.hasActiveProvider()).toBe(false);

    // Register provider but don't activate
    manager.registerProvider(mockProvider);
    expect(manager.hasActiveProvider()).toBe(false);

    // Activate provider
    manager.setActiveProvider('openai');
    expect(manager.hasActiveProvider()).toBe(true);

    // Clear active provider
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
  });
});
