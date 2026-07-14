/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('LoadBalancingProvider', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  afterEach(() => {
    // Clean up any registered providers
  });

  describe('IProvider interface compliance', () => {
    it('should implement IProvider interface with required name property', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found - implement it first',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-lb-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-profile-1',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      // Verify it's a valid provider object
      expect(provider).toBeDefined();
      expect(typeof provider).toBe('object');

      // Verify IProvider.name property exists and is correct
      expect(provider).toHaveProperty('name');
      expect(provider.name).toBe('load-balancer');
    });

    it('should have getModels method that returns a Promise', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-lb-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-profile-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toHaveProperty('getModels');
      expect(typeof provider.getModels).toBe('function');

      const result = provider.getModels();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should have generateChatCompletion method that returns AsyncIterableIterator', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-lb-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-profile-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toHaveProperty('generateChatCompletion');
      expect(typeof provider.generateChatCompletion).toBe('function');
    });

    it('should have getDefaultModel method that returns a string', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-lb-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-profile-1',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toHaveProperty('getDefaultModel');
      expect(typeof provider.getDefaultModel).toBe('function');

      const result = provider.getDefaultModel();
      expect(result).toBe('gemini-flash');
    });

    it('returns the first resolved sub-profile model as the default model', () => {
      const resolvedSubProfile: ResolvedSubProfile = {
        name: 'resolved-1',
        providerName: 'anthropic',
        model: 'claude-opus-4',
        ephemeralSettings: {},
        modelParams: {},
      };
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'resolved-default-test',
        strategy: 'round-robin',
        subProfiles: [resolvedSubProfile],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider.getDefaultModel()).toBe('claude-opus-4');
    });

    it('uses the first sub-profile model as runtime default for foreground load-balancer calls', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'glm',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'anthropic-fast',
            providerName: 'anthropic',
            modelId: 'claude-sonnet-4',
          },
        ],
      };
      const configWithoutGlobalModel = createRuntimeConfigStub(
        settingsService,
        {
          getModel: () => undefined,
        },
      );
      const localProviderManager = new ProviderManager({
        settingsService,
        config: configWithoutGlobalModel,
      });
      const provider = new LoadBalancingProvider(
        lbConfig,
        localProviderManager,
      );
      localProviderManager.registerProvider(provider);
      settingsService.set('activeProvider', 'anthropic');

      const normalized = localProviderManager.normalizeRuntimeInputs(
        {
          contents: [],
          settings: settingsService,
          config: configWithoutGlobalModel,
          resolved: { authToken: 'token' },
        } satisfies GenerateChatOptions,
        'load-balancer',
      );

      expect(normalized.resolved?.model).toBe('claude-sonnet-4');
    });

    it('rejects requests that exceed an explicit load balancer context limit before delegating', async () => {
      const delegateProvider: IProvider & { calls: number } = {
        name: 'openai',
        getModels: async () => [],
        getDefaultModel: () => 'gpt-4o',
        calls: 0,
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          this.calls += 1;
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getServerTools: () => [],
        invokeServerTool: async () => {
          throw new Error('unexpected server tool invocation');
        },
      };
      providerManager.registerProvider(delegateProvider);
      const provider = new LoadBalancingProvider(
        {
          profileName: 'tiny-lb',
          strategy: 'round-robin',
          contextLimit: 1,
          subProfiles: [
            {
              name: 'primary',
              providerName: 'openai',
              modelId: 'gpt-4o',
            },
          ],
        },
        providerManager,
      );

      const iterator = provider.generateChatCompletion({
        contents: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'this prompt is deliberately longer than one token',
              },
            ],
          },
        ],
      });

      await expect(iterator.next()).rejects.toThrow(/context limit exceeded/);
      expect(delegateProvider.calls).toBe(0);
    });

    it('should have getServerTools method that returns an array', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-lb-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-profile-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toHaveProperty('getServerTools');
      expect(typeof provider.getServerTools).toBe('function');

      const result = provider.getServerTools();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should have invokeServerTool method', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-lb-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-profile-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toHaveProperty('invokeServerTool');
      expect(typeof provider.invokeServerTool).toBe('function');
    });
  });
  describe('constructor configuration acceptance', () => {
    it('should accept array of sub-profile configurations', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'multi-sub-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'gemini-flash-profile',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
          {
            name: 'gemini-pro-profile',
            providerName: 'gemini',
            modelId: 'gemini-pro',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('load-balancer');
    });

    it('should accept sub-profiles with baseURL configuration', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'multi-endpoint-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'endpoint-1',
            providerName: 'openai',
            modelId: 'gpt-4',
            baseURL: 'https://api1.example.com',
          },
          {
            name: 'endpoint-2',
            providerName: 'openai',
            modelId: 'gpt-4',
            baseURL: 'https://api2.example.com',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
    });

    it('should accept sub-profiles with authToken configuration', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'multi-auth-profile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'account-1',
            providerName: 'gemini',
            modelId: 'gemini-flash',
            authToken: 'token-account-1',
          },
          {
            name: 'account-2',
            providerName: 'gemini',
            modelId: 'gemini-flash',
            authToken: 'token-account-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
    });

    it('should accept profileName in configuration', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const profileName = 'my-custom-load-balancer';
      const lbConfig: LoadBalancingProviderConfig = {
        profileName,
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
      // Profile name should be stored internally (will verify in later phases)
    });

    it('should accept strategy configuration (round-robin)', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'strategy-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
      // Strategy should be stored internally (will verify in later phases)
    });
  });
  describe('ProviderManager dependency injection', () => {
    it('should accept ProviderManager in constructor', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'dependency-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'gemini',
          },
        ],
      };

      // Should not throw when ProviderManager is provided
      expect(
        () => new LoadBalancingProvider(lbConfig, providerManager),
      ).not.toThrow();
    });

    it('should require ProviderManager dependency (not optional)', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'dependency-required-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'gemini',
          },
        ],
      };

      // Constructor should require ProviderManager
      // TypeScript will catch this at compile time, but we test runtime behavior
      expect(() => {
        new LoadBalancingProvider(
          lbConfig,
          undefined as unknown as IProviderManager,
        );
      }).toThrow(/requires a ProviderManager dependency/);
    });
  });
  describe('provider name exposure', () => {
    it('should expose provider name as "load-balancer"', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'name-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'gemini',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider.name).toBe('load-balancer');
    });

    it('should have consistent name across multiple instances', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const config1: LoadBalancingProviderConfig = {
        profileName: 'instance-1',
        strategy: 'round-robin',
        subProfiles: [{ name: 'sub-1', providerName: 'gemini' }],
      };

      const config2: LoadBalancingProviderConfig = {
        profileName: 'instance-2',
        strategy: 'round-robin',
        subProfiles: [{ name: 'sub-2', providerName: 'openai' }],
      };

      const provider1 = new LoadBalancingProvider(config1, providerManager);
      const provider2 = new LoadBalancingProvider(config2, providerManager);

      expect(provider1.name).toBe('load-balancer');
      expect(provider2.name).toBe('load-balancer');
      expect(provider1.name).toBe(provider2.name);
    });
  });
  describe('configuration validation', () => {
    it('should throw error if subProfiles array is empty', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'empty-subprofiles',
        strategy: 'round-robin',
        subProfiles: [],
      };

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/at least one sub-profile/);
    });

    it('should throw error if subProfile lacks required name field', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig = {
        profileName: 'invalid-subprofile',
        strategy: 'round-robin',
        subProfiles: [
          {
            // name is missing
            providerName: 'gemini',
          },
        ],
      } as LoadBalancingProviderConfig;

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/valid "name" field/);
    });

    it('should throw error if subProfile lacks required providerName field', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig = {
        profileName: 'invalid-subprofile',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            // providerName is missing
          },
        ],
      } as LoadBalancingProviderConfig;

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/valid "providerName" field/);
    });

    it('should accept minimal valid configuration', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'minimal-config',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'minimal-sub',
            providerName: 'gemini',
            // modelId, baseURL, authToken are optional
          },
        ],
      };

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).not.toThrow();
    });
  });
  describe('type safety', () => {
    it('should maintain proper TypeScript types for config', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'type-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'typed-sub',
            providerName: 'gemini',
            modelId: 'gemini-flash',
            baseURL: 'https://api.example.com',
            authToken: 'test-token',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      // Verify provider is typed as IProvider
      const asProvider: IProvider = provider;
      expect(asProvider.name).toBe('load-balancer');
    });

    it('should not accept invalid strategy values', () => {
      expect(
        LoadBalancingProvider,
        'LoadBalancingProvider class not found',
      ).toBeDefined();

      // TypeScript should prevent this at compile time
      // We test runtime behavior here
      const invalidConfig = {
        profileName: 'invalid-strategy',
        strategy: 'invalid-strategy-type', // Not 'round-robin'
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'gemini',
          },
        ],
      };

      expect(() => {
        new LoadBalancingProvider(
          invalidConfig as unknown as LoadBalancingProviderConfig,
          providerManager,
        );
      }).toThrow(/Invalid strategy/);
    });
  });
});
