/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProviderManager } from './ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IProvider } from './IProvider.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

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
    const fallback = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'fallback-context',
    });
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
    manager.setActiveProvider('stub-provider');

    expect(settingsService.get('activeProvider')).toBe('stub-provider');
    expect(manager.getActiveProvider()).toBeDefined();
    expect(manager.getActiveProvider()?.name).toBe('stub-provider');
  });

  it('requires an explicit runtime and never reads ambient global state (issue #2300)', () => {
    // Even with an ambient context set, the no-arg constructor must refuse to
    // adopt it — identity is supplied explicitly, never inferred.
    const ambientSettings = new SettingsService();
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: ambientSettings,
        runtimeId: 'ambient-should-be-ignored',
        metadata: { source: 'unit-test-ambient' },
      }),
    );

    expect(() => new ProviderManager()).toThrow(
      /does not read ambient global runtime state/,
    );
  });

  it('binds to the explicitly provided runtime context, not the ambient one', () => {
    const ambientSettings = new SettingsService();
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: ambientSettings,
        runtimeId: 'ambient-context',
        metadata: { source: 'unit-test-ambient' },
      }),
    );

    const explicitSettings = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService: explicitSettings,
      runtimeId: 'explicit-context',
      metadata: { source: 'unit-test-explicit' },
    });

    const manager = new ProviderManager(runtime);
    manager.registerProvider(createStubProvider('explicit-provider'));
    manager.setActiveProvider('explicit-provider');

    // The active provider is written to the EXPLICIT settings service, and the
    // ambient one is left untouched.
    expect(explicitSettings.get('activeProvider')).toBe('explicit-provider');
    expect(ambientSettings.get('activeProvider')).toBeUndefined();
    expect(manager.getActiveProvider()?.name).toBe('explicit-provider');
  });
});
