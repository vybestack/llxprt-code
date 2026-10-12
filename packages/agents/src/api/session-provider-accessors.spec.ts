import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { describe, expect, it, beforeEach, vi, type Mock } from 'bun:test';
import { useRuntimeTestOwners } from '../../../providers/src/runtime/__tests__/runtime-owner-test-helpers.js';
import type {
  RuntimeProvider,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { SessionProviderReads } from './session-provider-reads.js';
import { assembleSettingsControl } from './control/settings-control.js';
function settingsControl(owner: SessionSettingsOwner) {
  return assembleSettingsControl(
    () => owner,
    () => {},
    () => {},
  );
}
import {
  setActiveModelParam,
  clearActiveModelParam,
} from '../../../providers/src/runtime/providerModelParameters.js';

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

    expect(
      new SessionProviderReads(
        owner,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveModelName(),
    ).toBe('owner-model');
    expect(
      new SessionProviderReads(
        owner,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('owner-provider');
  });
  it('keeps equal-label owners separate without requiring profile services', () => {
    const firstSettings = new SettingsService();
    firstSettings.set('activeProvider', 'first-provider');
    const secondSettings = new SettingsService();
    secondSettings.set('activeProvider', 'second-provider');
    const first = roots.config('same-label', firstSettings).settingsOwner;
    const second = roots.config('same-label', secondSettings).settingsOwner;
    expect(
      new SessionProviderReads(
        first,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('first-provider');
    expect(
      new SessionProviderReads(
        second,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('second-provider');
  });

  it('rejects an incomplete supplied owner rather than borrowing the ambient runtime', () => {
    const owner = {};
    expect(() =>
      Reflect.construct(SessionProviderReads, [
        owner,
        mockRuntimeProviderManager,
        () => declaredModel,
      ]).getActiveProviderName(),
    ).toThrow('Provider reads require an explicit session owner');
  });

  describe('explicit owner capabilities', () => {
    it('rejects missing owner without selecting a registered runtime', () => {
      expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
    });
    it('resolves the supplied owner and its provider manager separately', () => {
      expect(
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).listProviders(),
      ).toStrictEqual(['openai', 'anthropic']);
    });
  });

  describe('getActiveModelName', () => {
    it('should return model from config when available', () => {
      const modelName = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveModelName();
      expect(typeof modelName).toBe('string');
    });
  });

  describe('settings round-trips on real owners', () => {
    const owners = useRuntimeTestOwners();
    it('sets, reads, and clears an ephemeral on only its supplied owner', () => {
      const { settingsOwner: first } = owners.config();
      const { settingsOwner: second } = owners.config();
      settingsControl(first).setEphemeralSetting('context-limit', 4096);
      settingsControl(second).setEphemeralSetting('context-limit', 8192);
      expect(first.readNamedParameter('context-limit')).toBe(4096);
      settingsControl(first).setEphemeralSetting('context-limit', undefined);
      expect(first.readNamedParameter('context-limit')).toBeUndefined();
      expect(first.isUserParameter('context-limit')).toBe(false);
      expect(second.readNamedParameter('context-limit')).toBe(8192);
    });

    it('returns the supplied owner ephemeral snapshot without including sibling writes', () => {
      const { settingsOwner: first } = owners.config();
      const { settingsOwner: second } = owners.config();
      settingsControl(first).setEphemeralSetting(
        'first-setting',
        'first-value',
      );
      settingsControl(second).setEphemeralSetting(
        'second-setting',
        'second-value',
      );
      expect(first.captureNamedParameters()).toMatchObject({
        'first-setting': 'first-value',
      });
      expect(first.captureNamedParameters()).not.toHaveProperty(
        'second-setting',
      );
    });

    it('sets and clears model parameters on exactly the supplied settings store and provider', () => {
      const first = new SettingsService();
      const second = new SettingsService();
      first.set('activeProvider', 'openai');
      second.set('activeProvider', 'openai');
      const firstOwner = owners.config('params-first', first).settingsOwner;
      const secondOwner = owners.config('params-second', second).settingsOwner;
      const firstReads = new SessionProviderReads(
        firstOwner,
        mockRuntimeProviderManager,
        () => '',
        (provider) => first.getProviderSettings(provider),
      );
      const secondReads = new SessionProviderReads(
        secondOwner,
        mockRuntimeProviderManager,
        () => '',
        (provider) => second.getProviderSettings(provider),
      );
      first.setProviderSetting('openai', 'model', 'reserved-model');
      setActiveModelParam('temperature', 0.7, first, 'openai');
      setActiveModelParam('temperature', 0.2, second, 'openai');
      expect(firstReads.getActiveModelParams()).toStrictEqual({
        temperature: 0.7,
      });
      clearActiveModelParam('temperature', first, 'openai');
      expect(firstReads.getActiveModelParams()).toStrictEqual({});
      expect(secondReads.getActiveModelParams()).toStrictEqual({
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

      const result = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getUnallowedParametersForActiveModel();
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

      expect(
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).getUnallowedParametersForActiveModel(),
      ).toContain('temperature');
    });

    it('returns an empty array for a model whose alias has no unallowed rules', () => {
      useProviderModel('openai', 'gpt-4');

      expect(
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).getUnallowedParametersForActiveModel(),
      ).toStrictEqual([]);
    });

    it('returns an empty array when there is no active provider', () => {
      mockSettingsService.set('activeProvider', undefined);
      expect(
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).getUnallowedParametersForActiveModel(),
      ).toStrictEqual([]);
    });
  });

  describe('provider queries', () => {
    it('should list providers', () => {
      const providers = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).listProviders();
      expect(Array.isArray(providers)).toBe(true);
    });

    it('reads owner selection before the manager cache', () => {
      mockSettingsService.set('activeProvider', 'selected-before-cache');
      const name = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveProviderName();
      expect(name).toBe('selected-before-cache');
    });

    it('should get active provider status', () => {
      const status = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).providerStatus();
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

      const status = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).providerStatus();

      expect(status).toStrictEqual({
        providerName: 'codex',
        modelName: 'gpt-5.6-sol',
        displayLabel: 'codex:gpt-5.6-sol',
        isPaidMode: false,
        baseURL: 'https://codex.example/v1',
      });
    });

    it('propagates a failed named provider lookup', () => {
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

      expect(() =>
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).providerStatus(),
      ).toThrow('boom');
    });

    it('falls back to the active provider metadata when no provider name is configured', () => {
      configureFor({ providerName: '', model: '' });

      const status = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).providerStatus();

      expect(status).toStrictEqual({
        providerName: 'gemini',
        modelName: 'gemini-2.5-pro',
        displayLabel: 'gemini:gemini-2.5-pro',
        isPaidMode: true,
        baseURL: 'https://gemini.example/v1',
      });
    });

    it('propagates a failed manager lookup', () => {
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

      expect(() =>
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).providerStatus(),
      ).toThrow('boom');
    });

    it('propagates failed provider metadata reads', () => {
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

      expect(() =>
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).providerStatus(),
      ).toThrow('boom');
    });

    it('propagates a failed provider base URL read', () => {
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

      expect(() =>
        new SessionProviderReads(
          mockConfig,
          mockRuntimeProviderManager,
          () => declaredModel,
          (provider) => mockSettingsService.getProviderSettings(provider),
        ).providerStatus(),
      ).toThrow('boom');
    });
  });

  describe('accessor functions', () => {
    it('should get session token usage', () => {
      const usage = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getSessionTokenUsage();
      expect(usage).toHaveProperty('input');
      expect(usage).toHaveProperty('output');
      expect(usage).toHaveProperty('total');
    });

    it('should get active provider metrics', () => {
      const metrics = new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).getActiveProviderMetrics();
      expect(metrics).toBeDefined();
    });

    it('should list available models', async () => {
      const models = await new SessionProviderReads(
        mockConfig,
        mockRuntimeProviderManager,
        () => declaredModel,
        (provider) => mockSettingsService.getProviderSettings(provider),
      ).listAvailableModels('openai');
      expect(Array.isArray(models)).toBe(true);
    });
  });
});
