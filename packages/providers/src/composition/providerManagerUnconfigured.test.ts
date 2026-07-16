/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the unconfigured-provider architecture (#2481).
 *
 * These tests exercise REAL createProviderManager + ProviderManager instances
 * (no mock theater) to verify that an unconfigured start leaves no provider
 * active and issues no implicit requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProviderManager,
  setFileSystem,
} from './providerManagerInstance.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MockFileSystem } from './IFileSystem.js';

/**
 * Builds a minimal Config stub sufficient for createProviderManager when the
 * `config` option is passed. Only the methods called by ProviderManager.setConfig
 * and the composition layer are provided.
 */
function makeMinimalConfig(
  overrides: Record<string, unknown> = {},
): import('@vybestack/llxprt-code-core').Config {
  return {
    getConversationLoggingEnabled: () => false,
    setProviderManager: () => {},
    setContentGeneratorFactory: () => {},
    setTokenizerFactory: () => {},
    getRedactionConfig: () => undefined,
    getModel: () => 'placeholder-model',
    getProxy: () => undefined,
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
    ...overrides,
  } as unknown as import('@vybestack/llxprt-code-core').Config;
}

function captureThrown(fn: () => unknown): { error: unknown } {
  try {
    fn();
  } catch (error) {
    return { error };
  }
  throw new Error('expected the call to throw, but it did not');
}

describe('createProviderManager: unconfigured state (#2481)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const mockFs = new MockFileSystem();
    setFileSystem(mockFs);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function buildUnconfiguredManager() {
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });
    return manager;
  }

  it('has no active provider when no config provider is set', () => {
    const manager = buildUnconfiguredManager();

    expect(manager.hasActiveProvider()).toBe(false);
    expect(manager.getActiveProviderName()).toBeUndefined();
  });

  it('getServerToolsProvider returns null when unconfigured', () => {
    const manager = buildUnconfiguredManager();

    expect(manager.getServerToolsProvider()).toBeNull();
  });

  it('does not issue any network request via getServerToolsProvider when unconfigured', () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const manager = buildUnconfiguredManager();
    const result = manager.getServerToolsProvider();

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still registers providers for explicit selection', () => {
    const manager = buildUnconfiguredManager();

    // Providers are registered (available for explicit selection) but none active.
    expect(manager.listProviders().length).toBeGreaterThan(0);
    expect(manager.hasActiveProvider()).toBe(false);
  });
});

describe('createProviderManager: explicit gemini unchanged (#2481)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const mockFs = new MockFileSystem();
    setFileSystem(mockFs);
  });

  it('activates gemini when explicitly set via setActiveProvider after creation', () => {
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    // No provider should be active initially (#2481).
    expect(manager.hasActiveProvider()).toBe(false);

    // Explicit gemini activation must still work.
    manager.setActiveProvider('gemini');
    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('gemini');

    // And server tools should be available for the explicitly active gemini.
    const serverTools = manager.getServerToolsProvider();
    expect(serverTools).not.toBeNull();
    expect(serverTools?.name).toBe('gemini');
  });

  it('auto-activates gemini from explicit settingsService activeProvider (no manual setActiveProvider)', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'gemini');
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    // When settingsService has activeProvider='gemini',
    // createProviderManager must auto-activate it without needing a manual
    // setActiveProvider call (same path as CLI profile/env resolution).
    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('gemini');
  });
});

describe('createProviderManager: invalid configured provider (#2481)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const mockFs = new MockFileSystem();
    setFileSystem(mockFs);
  });

  it('throws when an explicitly-configured provider name is invalid (typo)', () => {
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({ settingsService });

    // Build a valid unconfigured manager first, then test that a typo'd
    // explicit provider name surfaces as a structured error.
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    // The manager has real providers registered. A typo'd name must throw
    // with the requested name preserved (not silently swallowed).
    expect(() => manager.setActiveProvider('geminii')).toThrow(/geminii/);
  });

  it('activateExplicitProvider does not swallow invalid provider errors', () => {
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    // Verify the error preserves the requested name.
    const captured = captureThrown(() =>
      manager.setActiveProvider('nonexistent-provider'),
    );
    expect(captured.error).toBeInstanceOf(Error);
    expect((captured.error as Error).message).toContain('nonexistent-provider');
  });

  it('preserves the original error cause when activation fails', () => {
    const settingsService = new SettingsService();
    // Set a whitespace-padded invalid provider name in the settingsService
    // so createProviderManager → activateExplicitProvider is exercised.
    settingsService.set('activeProvider', 'nonexistent-provider');
    const runtime = createProviderRuntimeContext({ settingsService });

    const captured = captureThrown(() =>
      createProviderManager(runtime, {
        allowBrowserEnvironment: true,
      }),
    );
    expect(captured.error).toBeInstanceOf(Error);
    // The original underlying error must be preserved as `cause`.
    expect((captured.error as Error).cause).toBeDefined();
  });
});

describe('createProviderManager: explicit provider trimming (#2481)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const mockFs = new MockFileSystem();
    setFileSystem(mockFs);
  });

  it('trims whitespace from settingsService activeProvider', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', '  gemini  ');
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('gemini');
  });

  it('treats whitespace-only activeProvider as unconfigured', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', '   ');
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    expect(manager.hasActiveProvider()).toBe(false);
  });

  it('getActiveProviderName returns undefined for whitespace-only configuration', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', '   ');
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    expect(manager.getActiveProviderName()).toBeUndefined();
  });

  it('getActiveProvider returns undefined for whitespace-only configuration', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', '   ');
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    expect(manager.getActiveProvider()).toBeUndefined();
  });
});

describe('createProviderManager: UNCONFIGURED_PROVIDER sentinel precedence (#2481)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const mockFs = new MockFileSystem();
    setFileSystem(mockFs);
  });

  it('treats UNCONFIGURED_PROVIDER sentinel in settingsService as absent', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'unconfigured');
    const runtime = createProviderRuntimeContext({ settingsService });
    const { manager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });

    // The sentinel must NOT activate a provider named 'unconfigured'.
    expect(manager.hasActiveProvider()).toBe(false);
  });

  it('falls through sentinel config provider to a real lower-precedence provider', () => {
    // config.getProvider() returns the sentinel; settingsService has a real
    // provider. resolveExplicitProvider must skip the sentinel and continue
    // to the settingsService source, activating the real provider.
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'gemini');
    const runtime = createProviderRuntimeContext({ settingsService });
    const config = makeMinimalConfig({ getProvider: () => 'unconfigured' });
    const { manager } = createProviderManager(runtime, {
      config,
      allowBrowserEnvironment: true,
    });

    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('gemini');
  });

  it('falls through whitespace-only config provider to a real settingsService provider', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'gemini');
    const runtime = createProviderRuntimeContext({ settingsService });
    const config = makeMinimalConfig({ getProvider: () => '   ' });
    const { manager } = createProviderManager(runtime, {
      config,
      allowBrowserEnvironment: true,
    });

    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('gemini');
  });
});
