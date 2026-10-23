/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers/ProviderManager.js';
import type { IProvider, IModel } from '@vybestack/llxprt-code-providers';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

const resources: Array<{
  manager: ProviderManager;
  owner: SessionSettingsOwner;
  config: Config;
}> = [];

afterEach(async () => {
  for (const { manager, owner, config } of resources.splice(0)) {
    manager.dispose();
    await owner.dispose();
    await config.dispose();
  }
});

function createManager(): ProviderManager {
  const settingsService = new SettingsService();
  const runtime = createProviderRuntimeContext({});
  const config = new Config({
    sessionId: 'provider-gemini-switching',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'model-1',
    debugMode: false,
    telemetry: { enabled: false, logConversations: false },
  });
  const owner = new SessionSettingsOwner(settingsService);
  owner.bindTelemetry(config);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settingsService,
    undefined,
    runtime,
    undefined,
    owner,
  );
  resources.push({ manager, owner, config });
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
