/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251211issue486b
 * Phase 1: LoadBalancingProvider Skeleton Tests (TDD)
 *
 * Tests MUST be written FIRST, implementation SECOND.
 * These tests verify:
 * 1. LoadBalancingProvider implements IProvider interface
 * 2. Accepts array of sub-profile configurations in constructor
 * 3. Exposes provider name as "load-balancer"
 * 4. Constructor accepts ProviderManager dependency
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import type { Config } from '../../config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
  isLoadBalancerProfileFormat,
} from '../LoadBalancingProvider.js';

describe('LoadBalancingProvider - Phase 1: Skeleton Implementation', () => {
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
      expect(typeof result).toBe('string');
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new LoadBalancingProvider(lbConfig, undefined as any);
      }).toThrow();
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
      }).toThrow();
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
      }).toThrow();
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
      }).toThrow();
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new LoadBalancingProvider(invalidConfig as any, providerManager);
      }).toThrow();
    });
  });

  describe('Phase 2: Round-Robin Selection Logic', () => {
    describe('basic round-robin selection', () => {
      it('should select first sub-profile on first request', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'round-robin-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'gemini-ultra' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Provider should expose a method to get next sub-profile for testing
        // This will fail until selectNextSubProfile() or getNextSubProfileName() is implemented
        expect(provider).toHaveProperty('selectNextSubProfile');
        expect(
          typeof (
            provider as unknown as { selectNextSubProfile: () => unknown }
          ).selectNextSubProfile,
        ).toBe('function');

        const selected = (
          provider as unknown as {
            selectNextSubProfile: () => { name: string };
          }
        ).selectNextSubProfile();
        expect(selected.name).toBe('sub-1');
      });

      it('should cycle through sub-profiles in order', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'round-robin-cycle-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'gemini-ultra' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Call selectNextSubProfile multiple times and verify order
        const selections: string[] = [];
        for (let i = 0; i < 3; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        expect(selections).toEqual(['sub-1', 'sub-2', 'sub-3']);
      });

      it('should wrap around after last sub-profile', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'round-robin-wrap-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'gemini-ultra' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Cycle through all sub-profiles and verify wrap-around
        const selections: string[] = [];
        for (let i = 0; i < 6; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        // Should cycle: sub-1, sub-2, sub-3, sub-1, sub-2, sub-3
        expect(selections).toEqual([
          'sub-1',
          'sub-2',
          'sub-3',
          'sub-1',
          'sub-2',
          'sub-3',
        ]);
      });

      it('should maintain counter across multiple calls', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'counter-persistence-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // First batch of selections
        const firstBatch: string[] = [];
        for (let i = 0; i < 2; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          firstBatch.push(selected.name);
        }

        expect(firstBatch).toEqual(['sub-1', 'sub-2']);

        // Second batch should continue from where we left off
        const secondBatch: string[] = [];
        for (let i = 0; i < 2; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          secondBatch.push(selected.name);
        }

        expect(secondBatch).toEqual(['sub-1', 'sub-2']);
      });
    });

    describe('round-robin with different sub-profile counts', () => {
      it('should handle 2 sub-profiles correctly', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'two-sub-profiles',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selections: string[] = [];
        for (let i = 0; i < 4; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        expect(selections).toEqual(['sub-1', 'sub-2', 'sub-1', 'sub-2']);
      });

      it('should handle 3 sub-profiles correctly', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'three-sub-profiles',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'gemini-ultra' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selections: string[] = [];
        for (let i = 0; i < 6; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        expect(selections).toEqual([
          'sub-1',
          'sub-2',
          'sub-3',
          'sub-1',
          'sub-2',
          'sub-3',
        ]);
      });

      it('should handle 4+ sub-profiles correctly', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'four-sub-profiles',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
            { name: 'sub-4', providerName: 'gemini', modelId: 'model-4' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selections: string[] = [];
        for (let i = 0; i < 8; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        expect(selections).toEqual([
          'sub-1',
          'sub-2',
          'sub-3',
          'sub-4',
          'sub-1',
          'sub-2',
          'sub-3',
          'sub-4',
        ]);
      });

      it('should handle 5 sub-profiles correctly', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'five-sub-profiles',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
            { name: 'sub-4', providerName: 'gemini', modelId: 'model-4' },
            { name: 'sub-5', providerName: 'gemini', modelId: 'model-5' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selections: string[] = [];
        for (let i = 0; i < 10; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        expect(selections).toEqual([
          'sub-1',
          'sub-2',
          'sub-3',
          'sub-4',
          'sub-5',
          'sub-1',
          'sub-2',
          'sub-3',
          'sub-4',
          'sub-5',
        ]);
      });
    });

    describe('single sub-profile edge case', () => {
      it('should always return the same sub-profile when only one exists', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'single-sub-profile',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'only-sub',
              providerName: 'gemini',
              modelId: 'gemini-flash',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selections: string[] = [];
        for (let i = 0; i < 5; i++) {
          const selected = (
            provider as unknown as {
              selectNextSubProfile: () => { name: string };
            }
          ).selectNextSubProfile();
          selections.push(selected.name);
        }

        // Should always return the same sub-profile
        expect(selections).toEqual([
          'only-sub',
          'only-sub',
          'only-sub',
          'only-sub',
          'only-sub',
        ]);
      });
    });

    describe('sub-profile selection returns full configuration', () => {
      it('should return complete sub-profile configuration including all fields', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'full-config-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'complete-sub',
              providerName: 'openai',
              modelId: 'gpt-4',
              baseURL: 'https://api.example.com',
              authToken: 'test-token-123',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selected = (
          provider as unknown as {
            selectNextSubProfile: () => {
              name: string;
              providerName: string;
              modelId?: string;
              baseURL?: string;
              authToken?: string;
            };
          }
        ).selectNextSubProfile();

        // Verify all fields are present
        expect(selected).toEqual({
          name: 'complete-sub',
          providerName: 'openai',
          modelId: 'gpt-4',
          baseURL: 'https://api.example.com',
          authToken: 'test-token-123',
        });
      });

      it('should return sub-profile with optional fields omitted', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'minimal-config-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'minimal-sub',
              providerName: 'gemini',
              // modelId, baseURL, authToken omitted
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selected = (
          provider as unknown as {
            selectNextSubProfile: () => {
              name: string;
              providerName: string;
              modelId?: string;
              baseURL?: string;
              authToken?: string;
            };
          }
        ).selectNextSubProfile();

        // Verify required fields are present, optional fields are undefined
        expect(selected.name).toBe('minimal-sub');
        expect(selected.providerName).toBe('gemini');
        expect(selected.modelId).toBeUndefined();
        expect(selected.baseURL).toBeUndefined();
        expect(selected.authToken).toBeUndefined();
      });
    });
  });

  describe('Phase 3: Request Delegation', () => {
    describe('generateChatCompletion delegates to correct provider', () => {
      it('should call selectNextSubProfile on each generateChatCompletion call', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'delegation-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Track which sub-profiles are selected during generateChatCompletion
        const selectionOrder: string[] = [];
        const originalSelectNext = (
          provider as unknown as {
            selectNextSubProfile: () => { name: string };
          }
        ).selectNextSubProfile.bind(provider);
        (
          provider as unknown as {
            selectNextSubProfile: () => { name: string };
          }
        ).selectNextSubProfile = () => {
          const selected = originalSelectNext();
          selectionOrder.push(selected.name);
          return selected;
        };

        // Create mock provider to be returned by ProviderManager
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'test response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        // Mock ProviderManager.getProviderByName to return our mock
        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // First call
          const iterator1 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          // Consume the iterator to trigger the delegation
          for await (const _chunk of iterator1) {
            // Consume iterator
          }

          // Second call
          const iterator2 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator2) {
            // Consume iterator
          }

          // Verify selectNextSubProfile was called in correct order
          expect(selectionOrder).toEqual(['sub-1', 'sub-2']);
        } finally {
          // Restore original method
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should delegate to correct provider based on sub-profile providerName', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'provider-delegation-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'gemini-sub',
              providerName: 'gemini',
              modelId: 'gemini-flash',
            },
            { name: 'openai-sub', providerName: 'openai', modelId: 'gpt-4' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Track which providers were requested from ProviderManager
        const providerRequests: string[] = [];
        const mockGeminiProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'gemini response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const mockOpenAIProvider = {
          name: 'openai',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'openai response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gpt-4',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = (name: string) => {
          providerRequests.push(name);
          if (name === 'gemini') return mockGeminiProvider as IProvider;
          if (name === 'openai') return mockOpenAIProvider as IProvider;
          return originalGetProvider(name);
        };

        try {
          // First call should go to gemini
          const iterator1 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
          });
          for await (const _chunk of iterator1) {
            // Consume
          }

          // Second call should go to openai
          const iterator2 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
          });
          for await (const _chunk of iterator2) {
            // Consume
          }

          // Verify correct providers were requested
          expect(providerRequests).toEqual(['gemini', 'openai']);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('passes resolved settings to delegate provider', () => {
      it('should pass resolved baseURL, authToken, and model via options.resolved', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'resolved-settings-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'custom-sub',
              providerName: 'gemini',
              modelId: 'custom-model',
              baseURL: 'https://custom.api.com',
              authToken: 'custom-token-123',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Capture the options passed to delegate provider
        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Verify options.resolved was passed with correct values
          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          expect(capturedOptions!.resolved!.model).toBe('custom-model');
          expect(capturedOptions!.resolved!.baseURL).toBe(
            'https://custom.api.com',
          );
          expect(capturedOptions!.resolved!.authToken).toBe('custom-token-123');
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should preserve existing resolved options if sub-profile does not override them', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'preserve-resolved-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'minimal-sub',
              providerName: 'gemini',
              // modelId, baseURL, authToken not specified
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Pass existing resolved options
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            resolved: {
              model: 'original-model',
              baseURL: 'https://original.api.com',
              authToken: 'original-token',
            },
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Verify original resolved options were preserved
          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          expect(capturedOptions!.resolved!.model).toBe('original-model');
          expect(capturedOptions!.resolved!.baseURL).toBe(
            'https://original.api.com',
          );
          expect(capturedOptions!.resolved!.authToken).toBe('original-token');
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should override existing resolved options with sub-profile settings', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'override-resolved-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'override-sub',
              providerName: 'gemini',
              modelId: 'override-model',
              baseURL: 'https://override.api.com',
              authToken: 'override-token',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Pass existing resolved options that should be overridden
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            resolved: {
              model: 'original-model',
              baseURL: 'https://original.api.com',
              authToken: 'original-token',
            },
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Verify sub-profile settings took precedence
          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          expect(capturedOptions!.resolved!.model).toBe('override-model');
          expect(capturedOptions!.resolved!.baseURL).toBe(
            'https://override.api.com',
          );
          expect(capturedOptions!.resolved!.authToken).toBe('override-token');
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('handles sub-profiles with different provider types', () => {
      it('should delegate to different provider types in round-robin fashion', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'mixed-providers-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'gemini-sub',
              providerName: 'gemini',
              modelId: 'gemini-flash',
            },
            { name: 'openai-sub', providerName: 'openai', modelId: 'gpt-4' },
            {
              name: 'anthropic-sub',
              providerName: 'anthropic',
              modelId: 'claude-3',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const responses: string[] = [];
        const mockGemini = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'gemini-response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const mockOpenAI = {
          name: 'openai',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'openai-response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gpt-4',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const mockAnthropic = {
          name: 'anthropic',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'anthropic-response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'claude-3',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = (name: string) => {
          if (name === 'gemini') return mockGemini as IProvider;
          if (name === 'openai') return mockOpenAI as IProvider;
          if (name === 'anthropic') return mockAnthropic as IProvider;
          return originalGetProvider(name);
        };

        try {
          // Make 3 calls to cycle through all providers
          for (let i = 0; i < 3; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const chunk of iterator) {
              if (chunk.parts?.[0] && 'text' in chunk.parts[0]) {
                responses.push(chunk.parts[0].text as string);
              }
            }
          }

          // Verify responses came from different providers in order
          expect(responses).toEqual([
            'gemini-response',
            'openai-response',
            'anthropic-response',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should pass correct model for each provider type', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'mixed-models-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'gemini-sub',
              providerName: 'gemini',
              modelId: 'gemini-flash',
            },
            {
              name: 'openai-sub',
              providerName: 'openai',
              modelId: 'gpt-4-turbo',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const capturedModels: string[] = [];
        const mockGemini = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedModels.push(options.resolved?.model ?? 'no-model');
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const mockOpenAI = {
          name: 'openai',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedModels.push(options.resolved?.model ?? 'no-model');
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gpt-4',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = (name: string) => {
          if (name === 'gemini') return mockGemini as IProvider;
          if (name === 'openai') return mockOpenAI as IProvider;
          return originalGetProvider(name);
        };

        try {
          // Make 2 calls to cycle through providers
          for (let i = 0; i < 2; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          // Verify correct models were passed to each provider
          expect(capturedModels).toEqual(['gemini-flash', 'gpt-4-turbo']);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('propagates streaming responses correctly', () => {
      it('should yield chunks from delegate provider', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'streaming-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'chunk1' }] };
            yield { role: 'model', parts: [{ text: 'chunk2' }] };
            yield { role: 'model', parts: [{ text: 'chunk3' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });

          const chunks: string[] = [];
          for await (const chunk of iterator) {
            if (chunk.parts?.[0] && 'text' in chunk.parts[0]) {
              chunks.push(chunk.parts[0].text as string);
            }
          }

          // Verify all chunks were yielded in order
          expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should propagate complex chunks with multiple parts', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'complex-chunks-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const complexChunk: IContent = {
          role: 'model',
          parts: [
            { text: 'text part' },
            { functionCall: { name: 'test', args: {} } },
          ],
        };

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield complexChunk;
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });

          const chunks: IContent[] = [];
          for await (const chunk of iterator) {
            chunks.push(chunk);
          }

          // Verify complex chunk was propagated correctly
          expect(chunks).toHaveLength(1);
          expect(chunks[0]).toEqual(complexChunk);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should handle streaming from different providers in round-robin', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'multi-stream-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'provider-1',
              providerName: 'provider1',
              modelId: 'model-1',
            },
            {
              name: 'provider-2',
              providerName: 'provider2',
              modelId: 'model-2',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider1 = {
          name: 'provider1',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'p1-chunk1' }] };
            yield { role: 'model', parts: [{ text: 'p1-chunk2' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const mockProvider2 = {
          name: 'provider2',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'p2-chunk1' }] };
            yield { role: 'model', parts: [{ text: 'p2-chunk2' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-2',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = (name: string) => {
          if (name === 'provider1') return mockProvider1 as IProvider;
          if (name === 'provider2') return mockProvider2 as IProvider;
          return originalGetProvider(name);
        };

        try {
          // First call to provider1
          const chunks1: string[] = [];
          const iterator1 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
          });
          for await (const chunk of iterator1) {
            if (chunk.parts?.[0] && 'text' in chunk.parts[0]) {
              chunks1.push(chunk.parts[0].text as string);
            }
          }

          // Second call to provider2
          const chunks2: string[] = [];
          const iterator2 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
          });
          for await (const chunk of iterator2) {
            if (chunk.parts?.[0] && 'text' in chunk.parts[0]) {
              chunks2.push(chunk.parts[0].text as string);
            }
          }

          // Verify chunks from each provider were propagated correctly
          expect(chunks1).toEqual(['p1-chunk1', 'p1-chunk2']);
          expect(chunks2).toEqual(['p2-chunk1', 'p2-chunk2']);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('error handling when delegate provider not found', () => {
      it('should throw error when ProviderManager cannot find delegate provider', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'missing-provider-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'sub-1',
              providerName: 'non-existent-provider',
              modelId: 'model-1',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () =>
          undefined as unknown as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });

          // Should throw error when trying to delegate
          await expect(async () => {
            for await (const _chunk of iterator) {
              // Should not get here
            }
          }).rejects.toThrow();
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should include sub-profile name and provider name in error message', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'detailed-error-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'my-sub-profile',
              providerName: 'missing-provider',
              modelId: 'model-1',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () =>
          undefined as unknown as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });

          // Should throw error with detailed message
          await expect(async () => {
            for await (const _chunk of iterator) {
              // Should not get here
            }
          }).rejects.toThrow(/my-sub-profile/);

          await expect(async () => {
            const iterator2 = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            });
            for await (const _chunk of iterator2) {
              // Should not get here
            }
          }).rejects.toThrow(/missing-provider/);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should not affect round-robin counter when provider is not found', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'counter-error-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'sub-1',
              providerName: 'valid-provider',
              modelId: 'model-1',
            },
            {
              name: 'sub-2',
              providerName: 'invalid-provider',
              modelId: 'model-2',
            },
            {
              name: 'sub-3',
              providerName: 'valid-provider',
              modelId: 'model-3',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'valid-provider',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const callCount = { count: 0 };
        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = (name: string) => {
          callCount.count++;
          if (name === 'invalid-provider')
            return undefined as unknown as IProvider;
          return mockProvider as IProvider;
        };

        try {
          // First call - should succeed (sub-1)
          const iterator1 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
          });
          for await (const _chunk of iterator1) {
            // Consume
          }

          // Second call - should fail (sub-2)
          const iterator2 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
          });
          await expect(async () => {
            for await (const _chunk of iterator2) {
              // Should not get here
            }
          }).rejects.toThrow();

          // Third call - should succeed (sub-3) - counter should have advanced despite error
          const iterator3 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test3' }] }],
          });
          for await (const _chunk of iterator3) {
            // Consume
          }

          // Verify all 3 providers were requested in order
          expect(callCount.count).toBe(3);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('passes other options to delegate provider', () => {
      it('should pass tools to delegate provider', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'tools-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const testTools: ProviderToolset = [
          {
            functionDeclarations: [
              {
                name: 'test_tool',
                description: 'A test tool',
                parametersJsonSchema: { type: 'object' },
              },
            ],
          },
        ];

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            tools: testTools,
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Verify tools were passed to delegate
          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.tools).toEqual(testTools);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should pass settings to delegate provider', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'settings-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const customSettings = new SettingsService();
        customSettings.set('custom-key', 'custom-value');

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            settings: customSettings,
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Verify settings were passed to delegate
          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.settings).toBe(customSettings);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should pass metadata to delegate provider', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'metadata-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const testMetadata = { requestId: 'test-123', source: 'unit-test' };

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            metadata: testMetadata,
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Verify metadata was passed to delegate
          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.metadata).toEqual(testMetadata);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });
  });

  describe('Phase 3c: Round-Robin with ResolvedSubProfile and Settings Merge', () => {
    describe('round-robin with ResolvedSubProfile', () => {
      it('should cycle through ResolvedSubProfiles on each request', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'resolved-sub-1',
            providerName: 'gemini',
            model: 'gemini-flash',
            baseURL: 'https://api1.example.com',
            authToken: 'token-1',
            ephemeralSettings: { temperature: 0.5 },
            modelParams: { maxTokens: 100 },
          },
          {
            name: 'resolved-sub-2',
            providerName: 'gemini',
            model: 'gemini-pro',
            baseURL: 'https://api2.example.com',
            authToken: 'token-2',
            ephemeralSettings: { temperature: 0.7 },
            modelParams: { maxTokens: 200 },
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'resolved-round-robin-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const selectionOrder: string[] = [];
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        const originalSelectNext = (
          provider as unknown as {
            selectNextSubProfile: () => ResolvedSubProfile;
          }
        ).selectNextSubProfile.bind(provider);

        (
          provider as unknown as {
            selectNextSubProfile: () => ResolvedSubProfile;
          }
        ).selectNextSubProfile = () => {
          const selected = originalSelectNext();
          selectionOrder.push(selected.name);
          return selected;
        };

        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 4 requests to verify round-robin cycling
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          expect(selectionOrder).toEqual([
            'resolved-sub-1',
            'resolved-sub-2',
            'resolved-sub-1',
            'resolved-sub-2',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('sub-profile settings are not overridden', () => {
      it('should use sub-profile provider, model, and auth settings', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'custom-sub',
            providerName: 'gemini',
            model: 'custom-model-xyz',
            baseURL: 'https://custom.api.example.com',
            authToken: 'custom-auth-token-abc',
            ephemeralSettings: { temperature: 0.9 },
            modelParams: { topP: 0.95 },
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'sub-profile-settings-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          expect(capturedOptions!.resolved!.model).toBe('custom-model-xyz');
          expect(capturedOptions!.resolved!.baseURL).toBe(
            'https://custom.api.example.com',
          );
          expect(capturedOptions!.resolved!.authToken).toBe(
            'custom-auth-token-abc',
          );
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should preserve sub-profile modelParams', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'params-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {},
            modelParams: {
              maxTokens: 500,
              topP: 0.9,
              topK: 40,
              stopSequences: ['END'],
            },
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'model-params-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify modelParams are in metadata
          expect(capturedOptions!.metadata?.modelParams).toEqual({
            maxTokens: 500,
            topP: 0.9,
            topK: 40,
            stopSequences: ['END'],
          });
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('ephemeralSettings merge (dumb merge)', () => {
      it('should merge LB profile ephemeralSettings over sub-profile ephemeralSettings', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'merge-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {
              temperature: 0.5,
              topP: 0.8,
              maxTokens: 100,
            },
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'merge-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
          lbProfileEphemeralSettings: {
            temperature: 0.9,
            maxTokens: 500,
          },
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify merged ephemeralSettings are in metadata
          expect(capturedOptions!.metadata?.ephemeralSettings).toEqual({
            temperature: 0.9,
            topP: 0.8,
            maxTokens: 500,
          });
          // Verify individual settings are mapped to resolved
          expect(capturedOptions!.resolved!.temperature).toBe(0.9);
          expect(capturedOptions!.resolved!.maxTokens).toBe(500);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should preserve sub-profile ephemeralSettings when LB profile has none', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'no-override-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {
              temperature: 0.7,
              maxTokens: 300,
            },
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'no-override-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify sub-profile ephemeralSettings are in metadata
          expect(capturedOptions!.metadata?.ephemeralSettings).toEqual({
            temperature: 0.7,
            maxTokens: 300,
          });
          // Verify individual settings are mapped to resolved
          expect(capturedOptions!.resolved!.temperature).toBe(0.7);
          expect(capturedOptions!.resolved!.maxTokens).toBe(300);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should use LB profile ephemeralSettings when sub-profile has empty settings', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'empty-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            ephemeralSettings: {},
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'lb-only-settings-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
          lbProfileEphemeralSettings: {
            temperature: 0.8,
            topK: 50,
          },
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        let capturedOptions: GenerateChatOptions | undefined;
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            capturedOptions = options;
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          expect(capturedOptions).toBeDefined();
          expect(capturedOptions!.resolved).toBeDefined();
          // Verify LB profile ephemeralSettings are in metadata
          expect(capturedOptions!.metadata?.ephemeralSettings).toEqual({
            temperature: 0.8,
            topK: 50,
          });
          // Verify individual settings that map to resolved are there
          expect(capturedOptions!.resolved!.temperature).toBe(0.8);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('isolated auth per sub-profile', () => {
      it('should use different auth tokens for different sub-profiles', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'account-1-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            authToken: 'account-1-token',
            ephemeralSettings: {},
            modelParams: {},
          },
          {
            name: 'account-2-sub',
            providerName: 'gemini',
            model: 'gemini-flash',
            authToken: 'account-2-token',
            ephemeralSettings: {},
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'isolated-auth-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const capturedAuthTokens: string[] = [];
        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            if (options.resolved?.authToken) {
              capturedAuthTokens.push(options.resolved.authToken);
            }
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 4 requests to cycle through both auth tokens twice
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          expect(capturedAuthTokens).toEqual([
            'account-1-token',
            'account-2-token',
            'account-1-token',
            'account-2-token',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should use different baseURLs for different sub-profiles', async () => {
        const resolvedSubProfiles: ResolvedSubProfile[] = [
          {
            name: 'endpoint-1-sub',
            providerName: 'openai',
            model: 'gpt-4',
            baseURL: 'https://endpoint1.example.com',
            ephemeralSettings: {},
            modelParams: {},
          },
          {
            name: 'endpoint-2-sub',
            providerName: 'openai',
            model: 'gpt-4',
            baseURL: 'https://endpoint2.example.com',
            ephemeralSettings: {},
            modelParams: {},
          },
        ];

        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'isolated-baseurl-test',
          strategy: 'round-robin',
          subProfiles: resolvedSubProfiles,
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const capturedBaseURLs: string[] = [];
        const mockProvider = {
          name: 'openai',
          async *generateChatCompletion(
            options: GenerateChatOptions,
          ): AsyncIterableIterator<IContent> {
            if (options.resolved?.baseURL) {
              capturedBaseURLs.push(options.resolved.baseURL);
            }
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gpt-4',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          expect(capturedBaseURLs).toEqual([
            'https://endpoint1.example.com',
            'https://endpoint2.example.com',
            'https://endpoint1.example.com',
            'https://endpoint2.example.com',
          ]);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });
  });

  describe('Phase 5: Stats Integration', () => {
    describe('getStats method exposure', () => {
      it('should expose getStats method that returns LoadBalancerStats', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'stats-exposure-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        // Verify getStats method exists
        expect(provider).toHaveProperty('getStats');
        expect(
          typeof (provider as unknown as { getStats: () => unknown }).getStats,
        ).toBe('function');

        // Call getStats and verify it returns an object
        const stats = (
          provider as unknown as { getStats: () => unknown }
        ).getStats();
        expect(stats).toBeDefined();
        expect(typeof stats).toBe('object');
      });

      it('should return stats with profileName field', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'my-test-profile',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { profileName: string };
          }
        ).getStats();

        expect(stats.profileName).toBe('my-test-profile');
      });

      it('should return stats with totalRequests field', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'total-requests-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { totalRequests: number };
          }
        ).getStats();

        expect(stats).toHaveProperty('totalRequests');
        expect(typeof stats.totalRequests).toBe('number');
      });

      it('should return stats with lastSelected field', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'last-selected-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { lastSelected: string | null };
          }
        ).getStats();

        expect(stats).toHaveProperty('lastSelected');
        // Can be null or string
        expect(
          stats.lastSelected === null || typeof stats.lastSelected === 'string',
        ).toBe(true);
      });

      it('should return stats with profileCounts field', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'profile-counts-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { profileCounts: Record<string, number> };
          }
        ).getStats();

        expect(stats).toHaveProperty('profileCounts');
        expect(typeof stats.profileCounts).toBe('object');
      });
    });

    describe('initial stats state (0 requests)', () => {
      it('should have totalRequests = 0 when no requests have been made', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'zero-requests-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { totalRequests: number };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(0);
      });

      it('should have lastSelected = null when no requests have been made', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'null-last-selected-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { lastSelected: string | null };
          }
        ).getStats();

        expect(stats.lastSelected).toBeNull();
      });

      it('should have all profileCounts = 0 when no requests have been made', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'zero-profile-counts-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => { profileCounts: Record<string, number> };
          }
        ).getStats();

        // ProfileCounts should be empty object or have all zeros
        const counts = Object.values(stats.profileCounts);
        const allZeroOrEmpty =
          counts.length === 0 || counts.every((c) => c === 0);
        expect(allZeroOrEmpty).toBe(true);
      });
    });

    describe('stats tracking after requests', () => {
      it('should track request count for single sub-profile after 1 request', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'single-request-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 1 request
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Check stats
          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(1);
          expect(stats.profileCounts['sub-1']).toBe(1);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should update lastSelected after first request', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'first-last-selected-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'first-sub',
              providerName: 'gemini',
              modelId: 'gemini-flash',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 1 request
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          // Check lastSelected
          const stats = (
            provider as unknown as {
              getStats: () => { lastSelected: string | null };
            }
          ).getStats();

          expect(stats.lastSelected).toBe('first-sub');
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should track round-robin distribution across 2 sub-profiles', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'two-profile-distribution-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'gemini-flash',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 4 requests (2 full round-robins)
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          // Check stats
          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(4);
          expect(stats.profileCounts['sub-1']).toBe(2);
          expect(stats.profileCounts['sub-2']).toBe(2);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should track round-robin distribution across 3 sub-profiles', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'three-profile-distribution-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 6 requests (2 full round-robins)
          for (let i = 0; i < 6; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          // Check stats
          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(6);
          expect(stats.profileCounts['sub-1']).toBe(2);
          expect(stats.profileCounts['sub-2']).toBe(2);
          expect(stats.profileCounts['sub-3']).toBe(2);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should track uneven distribution correctly (7 requests, 3 profiles)', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'uneven-distribution-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 7 requests (2 full round-robins + 1 extra)
          for (let i = 0; i < 7; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          // Check stats
          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(7);
          // Round-robin: sub-1, sub-2, sub-3, sub-1, sub-2, sub-3, sub-1
          expect(stats.profileCounts['sub-1']).toBe(3); // Gets one extra
          expect(stats.profileCounts['sub-2']).toBe(2);
          expect(stats.profileCounts['sub-3']).toBe(2);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should update lastSelected to most recent sub-profile', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'last-selected-update-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make requests and check lastSelected after each
          const expectedOrder = ['sub-1', 'sub-2', 'sub-3', 'sub-1', 'sub-2'];

          for (let i = 0; i < expectedOrder.length; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }

            const stats = (
              provider as unknown as {
                getStats: () => { lastSelected: string | null };
              }
            ).getStats();

            expect(stats.lastSelected).toBe(expectedOrder[i]);
          }
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('stats persistence across multiple calls', () => {
      it('should accumulate stats across multiple generateChatCompletion calls', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'stats-accumulation-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // First batch: 2 requests
          for (let i = 0; i < 2; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          let stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(2);
          expect(stats.profileCounts['sub-1']).toBe(1);
          expect(stats.profileCounts['sub-2']).toBe(1);

          // Second batch: 3 more requests
          for (let i = 2; i < 5; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          // Total should be 5 (2 + 3)
          expect(stats.totalRequests).toBe(5);
          // Round-robin: sub-1, sub-2, sub-1, sub-2, sub-1
          expect(stats.profileCounts['sub-1']).toBe(3);
          expect(stats.profileCounts['sub-2']).toBe(2);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should not reset stats between calls', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'stats-persistence-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make requests one at a time and check stats increment
          for (let expectedTotal = 1; expectedTotal <= 5; expectedTotal++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }

            const stats = (
              provider as unknown as {
                getStats: () => { totalRequests: number };
              }
            ).getStats();

            expect(stats.totalRequests).toBe(expectedTotal);
          }
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('stats with different provider types', () => {
      it('should track stats correctly when using different provider types', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'mixed-provider-stats-test',
          strategy: 'round-robin',
          subProfiles: [
            {
              name: 'gemini-sub',
              providerName: 'gemini',
              modelId: 'gemini-flash',
            },
            { name: 'openai-sub', providerName: 'openai', modelId: 'gpt-4' },
            {
              name: 'anthropic-sub',
              providerName: 'anthropic',
              modelId: 'claude-3',
            },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const createMockProvider = (name: string) => ({
          name,
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: `${name} response` }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        });

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = (name: string) => {
          if (name === 'gemini')
            return createMockProvider('gemini') as IProvider;
          if (name === 'openai')
            return createMockProvider('openai') as IProvider;
          if (name === 'anthropic')
            return createMockProvider('anthropic') as IProvider;
          return originalGetProvider(name);
        };

        try {
          // Make 6 requests (2 full round-robins)
          for (let i = 0; i < 6; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
                lastSelected: string | null;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(6);
          expect(stats.profileCounts['gemini-sub']).toBe(2);
          expect(stats.profileCounts['openai-sub']).toBe(2);
          expect(stats.profileCounts['anthropic-sub']).toBe(2);
          expect(stats.lastSelected).toBe('anthropic-sub'); // Last in round-robin
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('percentage distribution calculation', () => {
      it('should allow calculation of percentage distribution from profileCounts', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'percentage-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 10 requests for easy percentage calculation
          for (let i = 0; i < 10; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          // Calculate percentages from stats
          const calculatePercentage = (count: number, total: number): number =>
            total === 0 ? 0 : (count / total) * 100;

          const percentage1 = calculatePercentage(
            stats.profileCounts['sub-1'],
            stats.totalRequests,
          );
          const percentage2 = calculatePercentage(
            stats.profileCounts['sub-2'],
            stats.totalRequests,
          );

          // With 10 requests and 2 profiles, should be 50% each
          expect(percentage1).toBe(50);
          expect(percentage2).toBe(50);
          expect(percentage1 + percentage2).toBe(100);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should support percentage calculation with uneven distribution', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'uneven-percentage-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 10 requests (3 profiles: 4, 3, 3 distribution)
          for (let i = 0; i < 10; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
              };
            }
          ).getStats();

          const calculatePercentage = (count: number, total: number): number =>
            total === 0 ? 0 : (count / total) * 100;

          const percentage1 = calculatePercentage(
            stats.profileCounts['sub-1'],
            stats.totalRequests,
          );
          const percentage2 = calculatePercentage(
            stats.profileCounts['sub-2'],
            stats.totalRequests,
          );
          const percentage3 = calculatePercentage(
            stats.profileCounts['sub-3'],
            stats.totalRequests,
          );

          // Round-robin: sub-1 (4 requests = 40%), sub-2 (3 = 30%), sub-3 (3 = 30%)
          expect(percentage1).toBe(40);
          expect(percentage2).toBe(30);
          expect(percentage3).toBe(30);
          expect(percentage1 + percentage2 + percentage3).toBe(100);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('optional stats reset capability', () => {
      it('should expose resetStats method for resetting statistics', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'reset-stats-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make some requests
          for (let i = 0; i < 4; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          // Verify stats are accumulated
          let stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
                lastSelected: string | null;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(4);

          // Reset stats
          (provider as unknown as { resetStats: () => void }).resetStats();

          // Verify stats are reset
          stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
                lastSelected: string | null;
              };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(0);
          expect(stats.lastSelected).toBeNull();

          const counts = Object.values(stats.profileCounts);
          const allZeroOrEmpty =
            counts.length === 0 || counts.every((c) => c === 0);
          expect(allZeroOrEmpty).toBe(true);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });

      it('should not affect round-robin counter when stats are reset', async () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'reset-no-affect-counter-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
            { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
            { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const mockProvider = {
          name: 'gemini',
          async *generateChatCompletion(): AsyncIterableIterator<IContent> {
            yield { role: 'model', parts: [{ text: 'response' }] };
          },
          getModels: async () => [],
          getDefaultModel: () => 'model-1',
          getServerTools: () => [],
          invokeServerTool: async () => ({}),
        };

        const originalGetProvider =
          providerManager.getProviderByName.bind(providerManager);
        providerManager.getProviderByName = () => mockProvider as IProvider;

        try {
          // Make 2 requests (sub-1, sub-2)
          for (let i = 0; i < 2; i++) {
            const iterator = provider.generateChatCompletion({
              contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
            });
            for await (const _chunk of iterator) {
              // Consume
            }
          }

          // Reset stats
          (provider as unknown as { resetStats: () => void }).resetStats();

          // Next request should still go to sub-3 (counter not reset)
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test post-reset' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          const stats = (
            provider as unknown as {
              getStats: () => {
                totalRequests: number;
                profileCounts: Record<string, number>;
                lastSelected: string | null;
              };
            }
          ).getStats();

          // After reset, should have 1 request to sub-3
          expect(stats.totalRequests).toBe(1);
          expect(stats.lastSelected).toBe('sub-3');
          expect(stats.profileCounts['sub-3']).toBe(1);
        } finally {
          providerManager.getProviderByName = originalGetProvider;
        }
      });
    });

    describe('stats type interface compliance', () => {
      it('should return stats conforming to LoadBalancerStats interface structure', () => {
        const lbConfig: LoadBalancingProviderConfig = {
          profileName: 'interface-compliance-test',
          strategy: 'round-robin',
          subProfiles: [
            { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
          ],
        };

        const provider = new LoadBalancingProvider(lbConfig, providerManager);

        const stats = (
          provider as unknown as {
            getStats: () => {
              profileName: string;
              lastSelected: string | null;
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        // Verify all required fields exist with correct types
        expect(typeof stats.profileName).toBe('string');
        expect(
          stats.lastSelected === null || typeof stats.lastSelected === 'string',
        ).toBe(true);
        expect(typeof stats.totalRequests).toBe('number');
        expect(typeof stats.profileCounts).toBe('object');
        expect(stats.profileCounts).not.toBeNull();
      });
    });
  });

  /**
   * @plan PLAN-20251211issue486c
   * Phase 1: Tests for Load Balancing Profile Type Definitions
   *
   * These tests verify the type guard functions and interfaces for detecting
   * and working with load balancer profiles in the new architecture.
   */
  describe('Load Balancer Profile Type Definitions - Phase 1', () => {
    describe('isLoadBalancerProfileFormat type guard', () => {
      it('should return true for valid load balancer profile', () => {
        const validProfile = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: ['profile1', 'profile2'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(validProfile)).toBe(true);
      });

      it('should reject standard profile without type field', () => {
        const standardProfile = {
          version: 1 as const,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(standardProfile)).toBe(false);
      });

      it('should reject profile with wrong type', () => {
        const wrongTypeProfile = {
          version: 1 as const,
          type: 'standard' as const,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(wrongTypeProfile)).toBe(false);
      });

      it('should reject old 486b inline format with loadBalancer property', () => {
        const oldInlineFormat = {
          version: 1 as const,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
          loadBalancer: {
            strategy: 'round-robin' as const,
            subProfiles: [
              {
                name: 'sub1',
                provider: 'openai',
                model: 'gpt-4',
              },
            ],
          },
        };

        expect(isLoadBalancerProfileFormat(oldInlineFormat)).toBe(false);
      });

      it('should reject profile with profiles as objects instead of strings', () => {
        const profilesAsObjects = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: [
            { name: 'profile1', provider: 'openai' },
            { name: 'profile2', provider: 'anthropic' },
          ],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(profilesAsObjects)).toBe(false);
      });

      it('should accept profile with empty profiles array (validation is separate)', () => {
        const emptyProfilesArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: [] as string[],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        // Type guard should pass - runtime validation happens elsewhere
        expect(isLoadBalancerProfileFormat(emptyProfilesArray)).toBe(true);
      });

      it('should reject profile missing profiles array', () => {
        const missingProfiles = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(missingProfiles)).toBe(false);
      });

      it('should reject profile with profiles as non-array', () => {
        const profilesNotArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: 'profile1,profile2',
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(profilesNotArray)).toBe(false);
      });

      it('should reject profile with mixed types in profiles array', () => {
        const mixedTypesArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: ['profile1', 123, 'profile2'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(mixedTypesArray)).toBe(false);
      });
    });

    describe('ResolvedSubProfile interface', () => {
      it('should support all required fields', () => {
        // This test verifies that a ResolvedSubProfile object can hold all necessary settings
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'openai',
          model: 'gpt-4',
          ephemeralSettings: {},
          modelParams: {},
        };

        // Verify all fields are accessible
        expect(resolvedSubProfile.name).toBe('test-profile');
        expect(resolvedSubProfile.providerName).toBe('openai');
        expect(resolvedSubProfile.model).toBe('gpt-4');
        expect(resolvedSubProfile.ephemeralSettings).toBeDefined();
        expect(resolvedSubProfile.modelParams).toBeDefined();
      });

      it('should support optional baseURL field', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'openai',
          model: 'gpt-4',
          baseURL: 'https://custom.api.endpoint',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(resolvedSubProfile.baseURL).toBe('https://custom.api.endpoint');
      });

      it('should support optional authToken field', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'anthropic',
          model: 'claude-3-opus',
          authToken: 'sk-ant-test-token',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(resolvedSubProfile.authToken).toBe('sk-ant-test-token');
      });

      it('should support optional authKeyfile field', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'google',
          model: 'gemini-pro',
          authKeyfile: '/path/to/keyfile.json',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(resolvedSubProfile.authKeyfile).toBe('/path/to/keyfile.json');
      });

      it('should support complex ephemeralSettings and modelParams', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'openai',
          model: 'gpt-4',
          ephemeralSettings: {
            streaming: 'enabled',
            'socket-timeout': 30000,
            retries: 3,
          },
          modelParams: {
            temperature: 0.7,
            maxTokens: 2000,
            topP: 0.9,
          },
        };

        expect(resolvedSubProfile.ephemeralSettings.streaming).toBe('enabled');
        expect(resolvedSubProfile.ephemeralSettings['socket-timeout']).toBe(
          30000,
        );
        expect(resolvedSubProfile.modelParams.temperature).toBe(0.7);
        expect(resolvedSubProfile.modelParams.maxTokens).toBe(2000);
      });

      it('should allow empty ephemeralSettings and modelParams', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'minimal-profile',
          providerName: 'openai',
          model: 'gpt-3.5-turbo',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(Object.keys(resolvedSubProfile.ephemeralSettings).length).toBe(
          0,
        );
        expect(Object.keys(resolvedSubProfile.modelParams).length).toBe(0);
      });

      it('should support all optional fields combined', () => {
        const fullyPopulatedProfile: ResolvedSubProfile = {
          name: 'full-profile',
          providerName: 'openai',
          model: 'gpt-4',
          baseURL: 'https://api.openai.com/v1',
          authToken: 'sk-test-token',
          authKeyfile: '/path/to/keyfile.json',
          ephemeralSettings: {
            streaming: 'enabled',
            retries: 5,
          },
          modelParams: {
            temperature: 0.8,
            maxTokens: 4000,
          },
        };

        // Verify all fields are present and accessible
        expect(fullyPopulatedProfile.name).toBe('full-profile');
        expect(fullyPopulatedProfile.providerName).toBe('openai');
        expect(fullyPopulatedProfile.model).toBe('gpt-4');
        expect(fullyPopulatedProfile.baseURL).toBe('https://api.openai.com/v1');
        expect(fullyPopulatedProfile.authToken).toBe('sk-test-token');
        expect(fullyPopulatedProfile.authKeyfile).toBe('/path/to/keyfile.json');
        expect(
          Object.keys(fullyPopulatedProfile.ephemeralSettings).length,
        ).toBeGreaterThan(0);
        expect(
          Object.keys(fullyPopulatedProfile.modelParams).length,
        ).toBeGreaterThan(0);
      });
    });
  });
});
