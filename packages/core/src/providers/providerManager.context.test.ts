/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProviderManager } from './ProviderManager.js';
import { SettingsService } from '../settings/SettingsService.js';
import type { IProvider } from './IProvider.js';
import {
  createProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';

function createStubProvider(name: string): IProvider {
  const generateChatCompletion = vi.fn(async function* () {
    yield { speaker: 'ai', blocks: [] };
  });

  return {
    name,
    isDefault: true,
    getModels: vi.fn(async () => []),
    getDefaultModel: () => 'stub-model',
    generateChatCompletion,
    getServerTools: () => [],
    invokeServerTool: vi.fn(),
  };
}

describe('ProviderManager runtime context', () => {
  afterEach(() => {
    const fallback = createProviderRuntimeContext();
    setActiveProviderRuntimeContext(fallback);
  });

  it('writes active provider to the injected settings service', async () => {
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService,
      runtimeId: 'manager-context-test',
      metadata: { source: 'unit-test' },
    });

    const manager = new ProviderManager(runtime);
    const provider = createStubProvider('stub-provider');

    manager.registerProvider(provider);

    expect(settingsService.get('activeProvider')).toBe('stub-provider');
    expect(manager.getActiveProvider()).toBeDefined();
    expect(manager.getActiveProvider().name).toBe('stub-provider');
  });

  it('respects legacy constructor by using the active runtime context', async () => {
    const previous = peekActiveProviderRuntimeContext();
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService,
      runtimeId: 'legacy-constructor-test',
      metadata: { source: 'unit-test-legacy' },
    });
    setActiveProviderRuntimeContext(runtime);

    const manager = new ProviderManager();
    const provider = createStubProvider('legacy-provider');

    manager.registerProvider(provider);

    expect(settingsService.get('activeProvider')).toBe('legacy-provider');
    expect(manager.getActiveProvider().name).toBe('legacy-provider');

    setActiveProviderRuntimeContext(previous ?? null);
  });
});
