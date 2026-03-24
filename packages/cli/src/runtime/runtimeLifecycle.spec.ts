/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  resetCliRuntimeRegistryForTesting,
  runtimeRegistry,
} from './runtimeRegistry.js';
import { configureCliStatelessHardening } from './statelessHardening.js';
import {
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  activateIsolatedRuntimeContext,
} from './runtimeLifecycle.js';
import {
  Config,
  SettingsService,
  ProviderManager,
  clearActiveProviderRuntimeContext,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import { OAuthManager } from '../auth/oauth-manager.js';
import { getCliProviderManager } from './runtimeAccessors.js';

/**
 * Test suite for runtimeLifecycle module
 *
 * These characterization tests verify the behavioral contracts of the
 * runtime lifecycle functions after extraction from runtimeSettings.ts.
 */
describe('runtimeLifecycle', () => {
  let mockConfig: Config;
  let mockSettingsService: SettingsService;
  let mockProviderManager: ProviderManager;
  let mockOAuthManager: OAuthManager;
  let mockMessageBus: MessageBus;

  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();

    // Create mock instances
    mockConfig = {
      getModel: vi.fn().mockReturnValue('gpt-4'),
      getProvider: vi.fn().mockReturnValue('openai'),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getEphemeralSetting: vi
        .fn()
        .mockImplementation((_key: string) => undefined),
      setEphemeralSetting: vi.fn(),
      setProviderManager: vi.fn(),
      setProvider: vi.fn(),
      setModel: vi.fn(),
    } as unknown as Config;

    mockSettingsService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'activeProvider') return 'openai';
        return undefined;
      }),
      getProviderSettings: vi.fn().mockReturnValue({ model: 'gpt-4' }),
      setProviderSetting: vi.fn(),
      set: vi.fn(),
    } as unknown as SettingsService;

    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue({
        name: 'openai',
        getDefaultModel: vi.fn().mockReturnValue('gpt-4'),
        isPaidMode: vi.fn().mockReturnValue(false),
      }),
      getActiveProviderName: vi.fn().mockReturnValue('openai'),
      listProviders: vi.fn().mockReturnValue(['openai', 'anthropic']),
      getProviderMetrics: vi.fn().mockReturnValue({}),
      getSessionTokenUsage: vi.fn().mockReturnValue({
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      }),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      setConfig: vi.fn(),
      prepareStatelessProviderInvocation: vi.fn(),
    } as unknown as ProviderManager;

    mockOAuthManager = {
      configureProactiveRenewalsForProfile: vi
        .fn()
        .mockResolvedValue(undefined),
    } as unknown as OAuthManager;

    mockMessageBus = {} as unknown as MessageBus;
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
  });

  describe('setCliRuntimeContext', () => {
    it('should set context and register entry in registry', () => {
      const runtimeId = 'test-runtime-1';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      const entry = runtimeRegistry.get(runtimeId);
      expect(entry).toBeDefined();
      expect(entry?.settingsService).toBe(mockSettingsService);
      expect(entry?.config).toBe(mockConfig);
    });

    it('should generate runtimeId if not provided', () => {
      setCliRuntimeContext(mockSettingsService, mockConfig);

      // Runtime should be registered with a generated ID
      expect(runtimeRegistry.size).toBe(1);
      const [registeredId] = Array.from(runtimeRegistry.keys());
      expect(registeredId).toMatch(/^cli-runtime-/);
    });

    it('should include metadata in the entry', () => {
      const runtimeId = 'test-runtime-2';
      const metadata = { customKey: 'customValue' };

      setCliRuntimeContext(mockSettingsService, mockConfig, {
        runtimeId,
        metadata,
      });

      const entry = runtimeRegistry.get(runtimeId);
      expect(entry?.metadata).toHaveProperty('customKey', 'customValue');
      expect(entry?.metadata).toHaveProperty('source', 'cli-runtime');
    });

    it('should support multiple runtimes with different IDs', () => {
      setCliRuntimeContext(mockSettingsService, mockConfig, {
        runtimeId: 'runtime-A',
      });
      setCliRuntimeContext(mockSettingsService, mockConfig, {
        runtimeId: 'runtime-B',
      });

      expect(runtimeRegistry.size).toBe(2);
      expect(runtimeRegistry.has('runtime-A')).toBe(true);
      expect(runtimeRegistry.has('runtime-B')).toBe(true);
    });

    it('should update existing entry when called with same ID', () => {
      const runtimeId = 'test-runtime-3';
      const newConfig = {
        getProvider: vi.fn().mockReturnValue('anthropic'),
      } as unknown as Config;

      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
      setCliRuntimeContext(mockSettingsService, newConfig, { runtimeId });

      expect(runtimeRegistry.size).toBe(1);
      const entry = runtimeRegistry.get(runtimeId);
      expect(entry?.config).toBe(newConfig);
    });
  });

  describe('registerCliProviderInfrastructure', () => {
    it('should update runtime entry with providerManager', () => {
      const runtimeId = 'test-runtime-infra-1';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      registerCliProviderInfrastructure(mockProviderManager, mockOAuthManager, {
        messageBus: mockMessageBus,
      });

      const entry = runtimeRegistry.get(runtimeId);
      expect(entry?.providerManager).toBe(mockProviderManager);
      expect(entry?.oauthManager).toBe(mockOAuthManager);
    });

    it('should allow getCliProviderManager to return registered manager', () => {
      const runtimeId = 'test-runtime-infra-2';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      registerCliProviderInfrastructure(mockProviderManager, mockOAuthManager, {
        messageBus: mockMessageBus,
      });

      const manager = getCliProviderManager();
      expect(manager).toBe(mockProviderManager);
    });

    it('should link provider manager to config when config exists', () => {
      const runtimeId = 'test-runtime-infra-3';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      registerCliProviderInfrastructure(mockProviderManager, mockOAuthManager, {
        messageBus: mockMessageBus,
      });

      expect(mockConfig.setProviderManager).toHaveBeenCalledWith(
        mockProviderManager,
      );
      expect(mockProviderManager.setConfig).toHaveBeenCalledWith(mockConfig);
    });
  });

  describe('resetCliProviderInfrastructure', () => {
    it('should clear providerManager from runtime entry', () => {
      const runtimeId = 'test-runtime-reset-1';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
      registerCliProviderInfrastructure(mockProviderManager, mockOAuthManager, {
        messageBus: mockMessageBus,
      });

      resetCliProviderInfrastructure(runtimeId);

      const entry = runtimeRegistry.get(runtimeId);
      expect(entry?.providerManager).toBeNull();
      expect(entry?.oauthManager).toBeNull();
    });

    it('should not throw when called on non-existent runtime', () => {
      expect(() =>
        resetCliProviderInfrastructure('non-existent-runtime'),
      ).not.toThrow();
    });

    it('should use active runtime ID when not provided', () => {
      const runtimeId = 'test-runtime-reset-2';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
      registerCliProviderInfrastructure(mockProviderManager, mockOAuthManager, {
        messageBus: mockMessageBus,
      });

      // Call without runtimeId - should use the active one
      resetCliProviderInfrastructure();

      const entry = runtimeRegistry.get(runtimeId);
      expect(entry?.providerManager).toBeNull();
    });
  });

  describe('activateIsolatedRuntimeContext', () => {
    const createMockHandle = (
      overrides: Partial<
        import('./runtimeContextFactory.js').IsolatedRuntimeContextHandle
      > = {},
    ): import('./runtimeContextFactory.js').IsolatedRuntimeContextHandle => ({
      runtimeId: 'isolated-runtime',
      metadata: {},
      settingsService: mockSettingsService,
      config: mockConfig,
      providerManager: mockProviderManager,
      oauthManager: mockOAuthManager,
      activate: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('should create entry with merged metadata', async () => {
      const mockHandle = createMockHandle({
        runtimeId: 'isolated-runtime-1',
        metadata: { baseKey: 'baseValue' },
      });

      await activateIsolatedRuntimeContext(mockHandle, {
        metadata: { overrideKey: 'overrideValue' },
      });

      const entry = runtimeRegistry.get('isolated-runtime-1');
      expect(entry?.metadata).toHaveProperty('baseKey', 'baseValue');
      expect(entry?.metadata).toHaveProperty('overrideKey', 'overrideValue');
      expect(mockHandle.activate).toHaveBeenCalled();
    });

    it('should use custom runtimeId from options', async () => {
      const mockHandle = createMockHandle({
        runtimeId: 'handle-runtime-id',
      });

      await activateIsolatedRuntimeContext(mockHandle, {
        runtimeId: 'custom-runtime-id',
      });

      expect(runtimeRegistry.has('custom-runtime-id')).toBe(true);
    });

    it('should call activate with merged options', async () => {
      const mockHandle = createMockHandle({
        runtimeId: 'isolated-runtime-2',
      });

      await activateIsolatedRuntimeContext(mockHandle, {
        runtimeId: 'custom-runtime-2',
        metadata: { testKey: 'testValue' },
      });

      expect(mockHandle.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeId: 'custom-runtime-2',
          metadata: { testKey: 'testValue' },
        }),
      );
    });
  });
});
