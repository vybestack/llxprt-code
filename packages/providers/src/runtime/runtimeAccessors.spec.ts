import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
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

import { describe, expect, it, beforeEach, vi, type Mock } from 'bun:test';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import { MissingProviderRuntimeError } from './messages.js';
import type {
  RuntimeProvider,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import {
  getActiveModelName,
  listProviders,
  getActiveProviderName,
  getSessionTokenUsage,
  listAvailableModels,
  getActiveProviderMetrics,
  getUnallowedParametersForActiveModel,
} from './providerReadOperations.js';
import {
  getEphemeralSetting,
  setEphemeralSetting,
  clearEphemeralSetting,
  getEphemeralSettings,
} from './ownerSettingsOperations.js';
import {
  getActiveModelParams,
  setActiveModelParam,
  clearActiveModelParam,
} from './providerModelParameters.js';
import { readProviderStatus } from './providerStatus.js';

/**
 * Test suite for runtimeAccessors module
 *
 * These characterization tests verify the behavioral contracts of the
 * runtime accessor functions after extraction from runtimeSettings.ts.
 */
describe('runtimeAccessors', () => {
  const roots = useRuntimeTestOwners();
  let mockConfig: SessionSettingsOwner;
  let declaredModel = 'gpt-4';
  let mockSettingsService: SettingsService;
  let mockRuntimeProviderManager: RuntimeProviderManager;
  beforeEach(() => {
    mockSettingsService = new SettingsService();
    mockSettingsService.set('activeProvider', 'openai');
    mockSettingsService.setProviderSetting('openai', 'model', 'gpt-4');
    mockConfig = roots.config(
      'owner-runtime',
      mockSettingsService,
    ).settingsOwner;
    declaredModel = 'gpt-4';

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

  it('reads the supplied owner without a registered runtime', () => {
    const settings = new SettingsService();
    settings.set('activeProvider', 'owner-provider');
    settings.setProviderSetting('owner-provider', 'model', 'owner-model');
    const owner = roots.config('owner-runtime', settings).settingsOwner;

    expect(getActiveModelName(owner)).toBe('owner-model');
    expect(getActiveProviderName(owner, mockRuntimeProviderManager)).toBe(
      'owner-provider',
    );
  });
  it('keeps equal-label owners separate without requiring profile services', () => {
    const firstSettings = new SettingsService();
    firstSettings.set('activeProvider', 'first-provider');
    const secondSettings = new SettingsService();
    secondSettings.set('activeProvider', 'second-provider');
    const first = roots.config('same-label', firstSettings).settingsOwner;
    const second = roots.config('same-label', secondSettings).settingsOwner;
    expect(getActiveProviderName(first, mockRuntimeProviderManager)).toBe(
      'first-provider',
    );
    expect(getActiveProviderName(second, mockRuntimeProviderManager)).toBe(
      'second-provider',
    );
  });

  it('rejects an incomplete supplied owner rather than borrowing the ambient runtime', () => {
    const owner = {};
    expect(() => Reflect.apply(listProviders, undefined, [owner])).toThrow(
      TypeError,
    );
  });

  describe('explicit owner capabilities', () => {
    it('rejects missing owner without selecting a registered runtime', () => {
      expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
        MissingProviderRuntimeError,
      );
    });
    it('resolves the supplied owner and its provider manager separately', () => {
      expect(listProviders(mockRuntimeProviderManager)).toStrictEqual([
        'openai',
        'anthropic',
      ]);
    });
  });

  describe('getActiveModelName', () => {
    it('should return model from config when available', () => {
      const modelName = getActiveModelName(mockConfig);
      expect(typeof modelName).toBe('string');
    });
  });

  describe('settings round-trips on real owners', () => {
    const owners = useRuntimeTestOwners();
    it('sets, reads, and clears an ephemeral on only its supplied owner', () => {
      const { settingsOwner: first } = owners.config();
      const { settingsOwner: second } = owners.config();
      setEphemeralSetting('context-limit', 4096, first);
      setEphemeralSetting('context-limit', 8192, second);
      expect(getEphemeralSetting('context-limit', first)).toBe(4096);
      clearEphemeralSetting('context-limit', first);
      expect(getEphemeralSetting('context-limit', first)).toBeUndefined();
      expect(first.isUserParameter('context-limit')).toBe(false);
      expect(getEphemeralSetting('context-limit', second)).toBe(8192);
    });

    it('returns the supplied owner ephemeral snapshot without including sibling writes', () => {
      const { settingsOwner: first } = owners.config();
      const { settingsOwner: second } = owners.config();
      setEphemeralSetting('first-setting', 'first-value', first);
      setEphemeralSetting('second-setting', 'second-value', second);
      expect(getEphemeralSettings(first)).toMatchObject({
        'first-setting': 'first-value',
      });
      expect(getEphemeralSettings(first)).not.toHaveProperty('second-setting');
    });

    it('sets and clears model parameters on exactly the supplied settings store and provider', () => {
      const first = new SettingsService();
      const second = new SettingsService();
      first.setProviderSetting('openai', 'model', 'reserved-model');
      setActiveModelParam('temperature', 0.7, first, 'openai');
      setActiveModelParam('temperature', 0.2, second, 'openai');
      expect(getActiveModelParams(first, 'openai')).toStrictEqual({
        temperature: 0.7,
      });
      clearActiveModelParam('temperature', first, 'openai');
      expect(getActiveModelParams(first, 'openai')).toStrictEqual({});
      expect(getActiveModelParams(second, 'openai')).toStrictEqual({
        temperature: 0.2,
      });
      expect(first.getProviderSettings('openai').model).toBe('reserved-model');
    });
  });

  describe('getUnallowedParametersForActiveModel', () => {
    const useProviderModel = (provider: string, model: string) => {
      mockSettingsService.set('activeProvider', provider);
      mockSettingsService.setProviderSetting(provider, 'model', model);
    };

    it('returns the kimi alias sampling params for kimi-k3', () => {
      useProviderModel('kimi', 'kimi-k3');

      const result = getUnallowedParametersForActiveModel(mockConfig);
      expect(result).toStrictEqual(
        expect.arrayContaining([
          'temperature',
          'top_p',
          'top_k',
          'frequency_penalty',
          'presence_penalty',
        ]),
      );
    });

    it('returns the kimi alias sampling params for k3-256k (broad rule match)', () => {
      useProviderModel('kimi', 'k3-256k');

      expect(getUnallowedParametersForActiveModel(mockConfig)).toContain(
        'temperature',
      );
    });

    it('returns an empty array for a model whose alias has no unallowed rules', () => {
      useProviderModel('openai', 'gpt-4');

      expect(getUnallowedParametersForActiveModel(mockConfig)).toStrictEqual(
        [],
      );
    });

    it('returns an empty array when there is no active provider', () => {
      mockSettingsService.set('activeProvider', undefined);
      expect(getUnallowedParametersForActiveModel(mockConfig)).toStrictEqual(
        [],
      );
    });
  });

  describe('provider queries', () => {
    it('should list providers', () => {
      const providers = listProviders(mockRuntimeProviderManager);
      expect(Array.isArray(providers)).toBe(true);
    });

    it('should get active provider name', () => {
      const name = getActiveProviderName(
        mockConfig,
        mockRuntimeProviderManager,
      );
      expect(name).toBe('openai');
    });

    it('should get active provider status', () => {
      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );
      expect(status).toHaveProperty('providerName');
      expect(status).toHaveProperty('modelName');
      expect(status).toHaveProperty('displayLabel');
    });
  });
  describe('provider status resolution', () => {
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
      mockSettingsService.set('activeProvider', opts.providerName ?? '');
      declaredModel = opts.model ?? '';
      if (opts.activeProvider !== undefined) {
        (
          mockRuntimeProviderManager.getActiveProviderName as Mock<
            typeof mockRuntimeProviderManager.getActiveProviderName
          >
        ).mockReturnValue(opts.activeProvider);
      }
      if (opts.providerName)
        mockSettingsService.setProviderSetting(
          opts.providerName,
          'model',
          opts.providerSettingsModel,
        );
    };

    beforeEach(() => {
      (
        mockRuntimeProviderManager.getActiveProvider as Mock<
          typeof mockRuntimeProviderManager.getActiveProvider
        >
      ).mockReturnValue(
        makeProvider({
          name: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          paid: true,
          baseURL: 'https://gemini.example/v1',
        }),
      );
      (
        mockRuntimeProviderManager.getActiveProviderName as Mock<
          typeof mockRuntimeProviderManager.getActiveProviderName
        >
      ).mockReturnValue('gemini');
      (
        mockRuntimeProviderManager.getProviderByName as Mock<
          typeof mockRuntimeProviderManager.getProviderByName
        >
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

      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );

      expect(status).toStrictEqual({
        providerName: 'codex',
        modelName: 'gpt-5.6-sol',
        displayLabel: 'codex:gpt-5.6-sol',
        isPaidMode: false,
        baseURL: 'https://codex.example/v1',
      });
    });

    it('keeps the resolved name but omits metadata when the named provider lookup fails', () => {
      (
        mockRuntimeProviderManager.getProviderByName as Mock<
          typeof mockRuntimeProviderManager.getProviderByName
        >
      ).mockImplementation(() => {
        throw new Error('boom');
      });
      configureFor({
        providerName: 'codex',
        model: 'gpt-5.6-sol',
        providerSettingsModel: 'gpt-5.6-sol',
      });

      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );

      expect(status.providerName).toBe('codex');
      expect(status.modelName).toBe('gpt-5.6-sol');
      expect(status.displayLabel).toBe('codex:gpt-5.6-sol');
      expect(status.isPaidMode).toBeUndefined();
      expect(status.baseURL).toBeUndefined();
    });

    it('falls back to the active provider metadata when no provider name is configured', () => {
      configureFor({ providerName: '', model: '' });

      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );

      expect(status).toStrictEqual({
        providerName: 'gemini',
        modelName: 'gemini-2.5-pro',
        displayLabel: 'gemini:gemini-2.5-pro',
        isPaidMode: true,
        baseURL: 'https://gemini.example/v1',
      });
    });

    it('degrades to null identity when manager lookups throw or the active provider is missing', () => {
      (
        mockRuntimeProviderManager.getActiveProvider as Mock<
          typeof mockRuntimeProviderManager.getActiveProvider
        >
      ).mockImplementation(() => {
        throw new Error('boom');
      });
      (
        mockRuntimeProviderManager.getActiveProviderName as Mock<
          typeof mockRuntimeProviderManager.getActiveProviderName
        >
      ).mockImplementation(() => {
        throw new Error('boom');
      });
      configureFor({ providerName: '', model: '' });

      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );

      expect(status.providerName).toBeNull();
      expect(status.modelName).toBeNull();
      expect(status.isPaidMode).toBeUndefined();
      expect(status.baseURL).toBeUndefined();
      expect(status.displayLabel).toBe('unknown');
    });

    it('isolates the resolved name from a throwing resolved-provider metadata method', () => {
      (
        mockRuntimeProviderManager.getProviderByName as Mock<
          typeof mockRuntimeProviderManager.getProviderByName
        >
      ).mockReturnValue(
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

      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );

      expect(status.providerName).toBe('codex');
      expect(status.modelName).toBe('gpt-5.6-sol');
      expect(status.baseURL).toBe('https://codex.example/v1');
      expect(status.isPaidMode).toBeUndefined();
    });

    it('omits baseURL when the active provider base URL accessor throws', () => {
      (
        mockRuntimeProviderManager.getActiveProvider as Mock<
          typeof mockRuntimeProviderManager.getActiveProvider
        >
      ).mockReturnValue(
        makeProvider({
          name: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          paid: true,
          baseURL: 'https://gemini.example/v1',
          throwing: 'getBaseURL',
        }),
      );
      (
        mockRuntimeProviderManager.getProviderByName as Mock<
          typeof mockRuntimeProviderManager.getProviderByName
        >
      ).mockImplementation((name: string) =>
        name === 'gemini'
          ? makeProvider({
              name: 'gemini',
              defaultModel: 'gemini-2.5-pro',
              paid: true,
              baseURL: 'https://gemini.example/v1',
              throwing: 'getBaseURL',
            })
          : undefined,
      );
      configureFor({ providerName: '', model: '' });

      const status = readProviderStatus(
        mockSettingsService,
        mockRuntimeProviderManager,
        declaredModel,
      );

      expect(status.providerName).toBe('gemini');
      expect(status.modelName).toBe('gemini-2.5-pro');
      expect(status.isPaidMode).toBe(true);
      expect(status.baseURL).toBeUndefined();
    });
  });

  describe('accessor functions', () => {
    it('should get session token usage', () => {
      const usage = getSessionTokenUsage(mockRuntimeProviderManager);
      expect(usage).toHaveProperty('input');
      expect(usage).toHaveProperty('output');
      expect(usage).toHaveProperty('total');
    });

    it('should get active provider metrics', () => {
      const metrics = getActiveProviderMetrics(mockRuntimeProviderManager);
      expect(metrics).toBeDefined();
    });

    it('should list available models', async () => {
      const models = await listAvailableModels(
        'openai',
        mockRuntimeProviderManager,
      );
      expect(Array.isArray(models)).toBe(true);
    });
  });
});
