/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createProviderManager } from './providerManagerInstance.js';
import type { IProvider } from './index.js';
import {
  createProviderRuntimeContext,
  SettingsService,
} from '@vybestack/llxprt-code-core';

function createManager() {
  const settingsService = new SettingsService();
  const runtime = createProviderRuntimeContext({ settingsService });
  const { manager } = createProviderManager(runtime, {
    allowBrowserEnvironment: true,
  });
  return manager;
}

function createMockProvider(name: string): IProvider {
  return {
    name,
    async getModels() {
      return [];
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: `${name}-response` }],
      };
    },
    getDefaultModel() {
      return `${name}-model`;
    },
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
  };
}

describe('Provider Switching Integration', () => {
  it('supports switching between providers and back to Gemini', () => {
    const manager = createManager();

    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (manager.hasActiveProvider()) {
      manager.clearActiveProvider();
    }
    expect(manager.hasActiveProvider()).toBe(false);

    manager.registerProvider(createMockProvider('test-provider'));
    manager.setActiveProvider('test-provider');
    expect(manager.getActiveProviderName()).toBe('test-provider');

    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBe('');
  });

  it('maintains custom providers in list without auto-registering gemini', () => {
    const manager = createManager();

    manager.registerProvider(createMockProvider('provider1'));
    manager.registerProvider(createMockProvider('provider2'));

    const providers = manager.listProviders();
    expect(providers).toContain('provider1');
    expect(providers).toContain('provider2');
    const customProviders = providers.filter((name) =>
      name.startsWith('provider'),
    );
    expect(customProviders).toStrictEqual(['provider1', 'provider2']);

    manager.setActiveProvider('provider1');
    expect(manager.getActiveProviderName()).toBe('provider1');

    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
  });
});
