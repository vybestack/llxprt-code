/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  upsertRuntimeEntry,
  resetCliRuntimeRegistryForTesting,
} from './runtimeRegistry.js';
import { configureCliStatelessHardening } from './statelessHardening.js';
import { setCliRuntimeContext } from './runtimeLifecycle.js';
import type {
  Config,
  RuntimeProvider,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '../auth/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core';

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
  let mockRuntimeProviderManager: RuntimeProviderManager;

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
      setRuntimeProviderManager: vi.fn(),
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

    mockRuntimeProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue({
        name: 'openai',
        getDefaultModel: vi.fn().mockReturnValue('gpt-4'),
        isPaidMode: vi.fn().mockReturnValue(false),
      }),
      getActiveProviderName: vi.fn().mockReturnValue('openai'),
      getProviderByName: vi.fn().mockReturnValue(undefined),
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
    } as unknown as RuntimeProviderManager;
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
  });

  // Helper to set up a complete runtime context with provider manager
  const setupCompleteRuntime = () => {
    const runtimeId = `test-runtime-${Date.now()}`;

    setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

    // Update the entry with the provider manager
    upsertRuntimeEntry(runtimeId, {
      providerManager: mockRuntimeProviderManager,
    });
    return runtimeId;
  };

  describe('getCliRuntimeServices', () => {
    it('should throw descriptive error when no runtime is registered', () => {
      expect(() => getCliRuntimeServices()).toThrow(
        /runtime|registered|initialized/i,
      );
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
      expect(mockSettingsService.setProviderSetting).toHaveBeenCalledWith(
        expect.any(String),
        'temperature',
        undefined,
      );
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
  describe('getActiveProviderStatus provider resolution', () => {
    type StubProvider = RuntimeProvider & {
      getBaseURL?: () => string | undefined;
    };

    const makeProvider = (opts: {
      name: string;
      defaultModel?: string;
      paid?: boolean;
      baseURL?: string;
      throwing?: 'isPaidMode' | 'getBaseURL';
    }): StubProvider => ({
      name: opts.name,
      getDefaultModel: () => opts.defaultModel ?? 'model',
      isPaidMode:
        opts.throwing === 'isPaidMode'
          ? () => {
              throw new Error('boom');
            }
          : () => opts.paid ?? false,
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion() {},
      ...(opts.baseURL !== undefined
        ? {
            getBaseURL:
              opts.throwing === 'getBaseURL'
                ? () => {
                    throw new Error('boom');
                  }
                : () => opts.baseURL,
          }
        : {}),
    });

    const configureFor = (opts: {
      providerName?: string;
      activeProvider?: string;
      model?: string;
      providerSettingsModel?: string;
    }): void => {
      vi.mocked(mockConfig.getProvider).mockReturnValue(
        opts.providerName ?? '',
      );
      vi.mocked(mockConfig.getModel).mockReturnValue(opts.model ?? '');
      vi.mocked(mockSettingsService.get).mockImplementation((key: string) =>
        key === 'activeProvider'
          ? (opts.activeProvider ?? opts.providerName)
          : undefined,
      );
      vi.mocked(mockSettingsService.getProviderSettings).mockReturnValue(
        opts.providerSettingsModel !== undefined
          ? { model: opts.providerSettingsModel }
          : {},
      );
      setupCompleteRuntime();
    };

    beforeEach(() => {
      vi.mocked(mockRuntimeProviderManager.getActiveProvider).mockReturnValue(
        makeProvider({
          name: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          paid: true,
          baseURL: 'https://gemini.example/v1',
        }),
      );
      vi.mocked(
        mockRuntimeProviderManager.getActiveProviderName,
      ).mockReturnValue('gemini');
      vi.mocked(
        mockRuntimeProviderManager.getProviderByName,
      ).mockImplementation((name: string) => {
        if (name === 'codex') {
          return makeProvider({
            name: 'codex',
            defaultModel: 'gpt-5.6-sol',
            paid: false,
            baseURL: 'https://codex.example/v1',
          });
        }
        if (name === 'gemini') {
          return makeProvider({
            name: 'gemini',
            defaultModel: 'gemini-2.5-pro',
            paid: true,
            baseURL: 'https://gemini.example/v1',
          });
        }
        return undefined;
      });
    });

    it('reports resolved codex identity and metadata while the active provider is still gemini', () => {
      configureFor({
        providerName: 'codex',
        activeProvider: 'gemini',
        model: 'gpt-5.6-sol',
        providerSettingsModel: 'gpt-5.6-sol',
      });

      const status = getActiveProviderStatus();

      expect(status).toStrictEqual({
        providerName: 'codex',
        modelName: 'gpt-5.6-sol',
        displayLabel: 'codex:gpt-5.6-sol',
        isPaidMode: false,
        baseURL: 'https://codex.example/v1',
      });
    });

    it('keeps the resolved name but omits metadata when the named provider lookup fails', () => {
      vi.mocked(
        mockRuntimeProviderManager.getProviderByName,
      ).mockImplementation(() => {
        throw new Error('boom');
      });
      configureFor({
        providerName: 'codex',
        model: 'gpt-5.6-sol',
        providerSettingsModel: 'gpt-5.6-sol',
      });

      const status = getActiveProviderStatus();

      expect(status.providerName).toBe('codex');
      expect(status.modelName).toBe('gpt-5.6-sol');
      expect(status.displayLabel).toBe('codex:gpt-5.6-sol');
      expect(status.isPaidMode).toBeUndefined();
      expect(status.baseURL).toBeUndefined();
    });

    it('falls back to the active provider metadata when no provider name is configured', () => {
      configureFor({ providerName: '', model: '' });

      const status = getActiveProviderStatus();

      expect(status).toStrictEqual({
        providerName: 'gemini',
        modelName: 'gemini-2.5-pro',
        displayLabel: 'gemini:gemini-2.5-pro',
        isPaidMode: true,
        baseURL: 'https://gemini.example/v1',
      });
    });

    it('degrades to null identity when manager lookups throw or the active provider is missing', () => {
      vi.mocked(
        mockRuntimeProviderManager.getActiveProvider,
      ).mockImplementation(() => {
        throw new Error('boom');
      });
      configureFor({ providerName: '', model: '' });

      const status = getActiveProviderStatus();

      expect(status.providerName).toBeNull();
      expect(status.modelName).toBeNull();
      expect(status.isPaidMode).toBeUndefined();
      expect(status.baseURL).toBeUndefined();
      expect(status.displayLabel).toBe('unknown');
    });

    it('isolates the resolved name from a throwing resolved-provider metadata method', () => {
      vi.mocked(mockRuntimeProviderManager.getProviderByName).mockReturnValue(
        makeProvider({
          name: 'codex',
          defaultModel: 'gpt-5.6-sol',
          baseURL: 'https://codex.example/v1',
          throwing: 'isPaidMode',
        }),
      );
      configureFor({
        providerName: 'codex',
        model: 'gpt-5.6-sol',
        providerSettingsModel: 'gpt-5.6-sol',
      });

      const status = getActiveProviderStatus();

      expect(status.providerName).toBe('codex');
      expect(status.modelName).toBe('gpt-5.6-sol');
      expect(status.baseURL).toBe('https://codex.example/v1');
      expect(status.isPaidMode).toBeUndefined();
    });

    it('omits baseURL when the active provider base URL accessor throws', () => {
      vi.mocked(mockRuntimeProviderManager.getActiveProvider).mockReturnValue(
        makeProvider({
          name: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          paid: true,
          baseURL: 'https://gemini.example/v1',
          throwing: 'getBaseURL',
        }),
      );
      configureFor({ providerName: '', model: '' });

      const status = getActiveProviderStatus();

      expect(status.providerName).toBe('gemini');
      expect(status.modelName).toBe('gemini-2.5-pro');
      expect(status.isPaidMode).toBe(true);
      expect(status.baseURL).toBeUndefined();
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
      expect(manager).toBe(mockRuntimeProviderManager);
    });

    it('should ignore non-function OAuth setAddItem fields', () => {
      const runtimeId = setupCompleteRuntime();
      upsertRuntimeEntry(runtimeId, {
        oauthManager: {
          providers: new Map([
            [
              'bad-provider',
              {
                name: 'bad-provider',
                setAddItem: true,
              },
            ],
          ]),
        },
      });

      expect(() => getCliProviderManager({ addItem: vi.fn() })).not.toThrow();
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

    it('should throw when CLI OAuth manager is missing from a partial runtime entry', () => {
      setupCompleteRuntime();

      expect(() => getCliOAuthManager()).toThrow(/OAuthManager/);
    });

    it('should get CLI OAuth manager for a complete subagent runtime entry', () => {
      const runtimeId = setupCompleteRuntime();
      const oauthManager = {} as OAuthManager;
      upsertRuntimeEntry(runtimeId, {
        runtimeKind: 'subagent',
        oauthManager,
      });

      expect(getCliOAuthManager()).toBe(oauthManager);
    });
  });

  describe('stateless readiness', () => {
    it('returns false instead of throwing when stateless mode has no active runtime', () => {
      configureCliStatelessHardening('strict');

      expect(isCliRuntimeStatelessReady()).toBe(false);
    });

    it('should check if runtime is stateless ready', () => {
      setupCompleteRuntime();

      const ready = isCliRuntimeStatelessReady();
      expect(typeof ready).toBe('boolean');
    });
  });
});
