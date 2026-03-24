/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  upsertRuntimeEntry,
  resetCliRuntimeRegistryForTesting,
} from './runtimeRegistry.js';
import { configureCliStatelessHardening } from './statelessHardening.js';
import { setCliRuntimeContext } from './runtimeLifecycle.js';
import {
  Config,
  SettingsService,
  ProviderManager,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';

import {
  getCliRuntimeServices,
  getActiveModelName,
  getActiveProviderStatus,
  getEphemeralSetting,
  setEphemeralSetting,
  clearEphemeralSetting,
  getActiveModelParams,
  setActiveModelParam,
  clearActiveModelParam,
  listProviders,
  getActiveProviderName,
  getCliProviderManager,
  getCliRuntimeConfig,
  getCliOAuthManager,
  getSessionTokenUsage,
  getEphemeralSettings,
  listAvailableModels,
  getActiveProviderMetrics,
  isCliRuntimeStatelessReady,
} from './runtimeAccessors.js';

/**
 * Test suite for runtimeAccessors module
 *
 * These characterization tests verify the behavioral contracts of the
 * runtime accessor functions after extraction from runtimeSettings.ts.
 */
describe('runtimeAccessors', () => {
  let mockConfig: Config;
  let mockSettingsService: SettingsService;
  let mockProviderManager: ProviderManager;

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
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
  });

  // Helper to set up a complete runtime context with provider manager
  const setupCompleteRuntime = () => {
    // setCliRuntimeContext generates its own runtimeId based on process.pid
    // We need to call it with a specific ID and then update with provider manager
    const runtimeId = `test-runtime-${Date.now()}`;

    // Set context with the specific ID
    setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

    // Update the entry with the provider manager
    upsertRuntimeEntry(runtimeId, { providerManager: mockProviderManager });
    return runtimeId;
  };

  describe('getCliRuntimeServices', () => {
    it('should throw descriptive error when no runtime is registered', () => {
      expect(() => getCliRuntimeServices()).toThrow();
    });

    it('should return services object with config, settingsService, providerManager', () => {
      setupCompleteRuntime();

      const services = getCliRuntimeServices();

      expect(services).toHaveProperty('settingsService');
      expect(services).toHaveProperty('config');
      expect(services).toHaveProperty('providerManager');
    });
  });

  describe('getActiveModelName', () => {
    it('should return model from config when available', () => {
      setupCompleteRuntime();

      const modelName = getActiveModelName();
      expect(typeof modelName).toBe('string');
    });
  });

  describe('ephemeral settings round-trip', () => {
    it('should get/set/clear ephemeral setting', () => {
      setupCompleteRuntime();

      // Set ephemeral setting
      setEphemeralSetting('test-key', 'test-value');
      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'test-key',
        'test-value',
      );

      // Get ephemeral setting
      getEphemeralSetting('test-key');
      expect(mockConfig.getEphemeralSetting).toHaveBeenCalledWith('test-key');

      // Clear ephemeral setting
      clearEphemeralSetting('test-key');
      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'test-key',
        undefined,
      );
    });

    it('should get all ephemeral settings', () => {
      setupCompleteRuntime();

      getEphemeralSettings();
      expect(mockConfig.getEphemeralSettings).toHaveBeenCalled();
    });
  });

  describe('model params round-trip', () => {
    it('should get/set/clear active model param', () => {
      setupCompleteRuntime();

      // Get active model params
      const params = getActiveModelParams();
      expect(typeof params).toBe('object');

      // Set active model param
      setActiveModelParam('temperature', 0.7);
      expect(mockSettingsService.setProviderSetting).toHaveBeenCalled();

      // Clear active model param
      clearActiveModelParam('temperature');
    });
  });

  describe('provider queries', () => {
    it('should list providers', () => {
      setupCompleteRuntime();

      const providers = listProviders();
      expect(Array.isArray(providers)).toBe(true);
    });

    it('should get active provider name', () => {
      setupCompleteRuntime();

      const name = getActiveProviderName();
      expect(name).toBe('openai');
    });

    it('should get active provider status', () => {
      setupCompleteRuntime();

      const status = getActiveProviderStatus();
      expect(status).toHaveProperty('providerName');
      expect(status).toHaveProperty('modelName');
      expect(status).toHaveProperty('displayLabel');
    });
  });

  describe('accessor functions', () => {
    it('should get CLI runtime config', () => {
      setupCompleteRuntime();

      const config = getCliRuntimeConfig();
      expect(config).toBe(mockConfig);
    });

    it('should get CLI provider manager', () => {
      setupCompleteRuntime();

      const manager = getCliProviderManager();
      expect(manager).toBe(mockProviderManager);
    });

    it('should get session token usage', () => {
      setupCompleteRuntime();

      const usage = getSessionTokenUsage();
      expect(usage).toHaveProperty('input');
      expect(usage).toHaveProperty('output');
      expect(usage).toHaveProperty('total');
    });

    it('should get active provider metrics', () => {
      setupCompleteRuntime();

      const metrics = getActiveProviderMetrics();
      expect(metrics).toBeDefined();
    });

    it('should list available models', async () => {
      setupCompleteRuntime();

      const models = await listAvailableModels('openai');
      expect(Array.isArray(models)).toBe(true);
    });

    it('should get CLI OAuth manager (null when not set)', () => {
      setupCompleteRuntime();

      const oauthManager = getCliOAuthManager();
      expect(oauthManager).toBeNull();
    });
  });

  describe('stateless readiness', () => {
    it('should check if runtime is stateless ready', () => {
      setupCompleteRuntime();

      const ready = isCliRuntimeStatelessReady();
      expect(typeof ready).toBe('boolean');
    });
  });
});
