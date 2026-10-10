/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import type { IProvider, IModel } from '@vybestack/llxprt-code-providers';
import { NodeFileSystem } from '@vybestack/llxprt-code-providers/composition.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';

function createManager() {
  const settingsService = new SettingsService();
  const runtime = createProviderRuntimeContext({ settingsService });
  const { manager } = createProviderManager(runtime, {
    allowBrowserEnvironment: true,
    fileSystem: new NodeFileSystem(),
  });
  return manager;
}

function createMockProvider(): IProvider {
  return {
    name: 'test-provider',
    async getModels(): Promise<IModel[]> {
      return [
        {
          id: 'model-1',
          name: 'Test Model 1',
          provider: 'test-provider',
          supportedToolFormats: ['json'],
        },
        {
          id: 'model-2',
          name: 'Test Model 2',
          provider: 'test-provider',
          supportedToolFormats: ['json'],
        },
      ];
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'test response' }],
      };
    },
    getDefaultModel() {
      return 'model-1';
    },
  };
}

describe('Provider-Gemini Switching', () => {
  it('keeps provider selection empty until a provider is explicitly activated', () => {
    const manager = createManager();
    manager.clearActiveProvider();
    manager.registerProvider(createMockProvider());
    expect(manager.hasActiveProvider()).toBe(false);
  });
  it('uses the explicitly selected provider for generation', async () => {
    const manager = createManager();
    manager.registerProvider(createMockProvider());
    manager.setActiveProvider('test-provider');
    const provider = manager.getActiveProvider();
    if (!provider) throw new Error('Expected selected provider');
    const result = [];
    for await (const content of provider.generateChatCompletion({
      contents: [],
      resolved: { model: 'model-1' },
    }))
      result.push(content);
    expect(
      result
        .flatMap((content) => content.blocks)
        .filter((block) => block.type === 'text'),
    ).toHaveLength(1);
    expect(manager.getActiveProviderName()).toBe('test-provider');
  });
  it('clears the selected provider without retiring registered providers', async () => {
    const manager = createManager();
    manager.registerProvider(createMockProvider());
    manager.setActiveProvider('test-provider');
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);
    manager.setActiveProvider('test-provider');
    const provider = manager.getActiveProvider();
    if (!provider) throw new Error('Expected selected provider');
    expect((await provider.getModels()).map((model) => model.id)).toStrictEqual(
      ['model-1', 'model-2'],
    );
  });
});
