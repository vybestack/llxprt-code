/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';

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

        expect(selections).toStrictEqual(['sub-1', 'sub-2', 'sub-3']);
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
        expect(selections).toStrictEqual([
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

        expect(firstBatch).toStrictEqual(['sub-1', 'sub-2']);

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

        expect(secondBatch).toStrictEqual(['sub-1', 'sub-2']);
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

        expect(selections).toStrictEqual(['sub-1', 'sub-2', 'sub-1', 'sub-2']);
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

        expect(selections).toStrictEqual([
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

        expect(selections).toStrictEqual([
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

        expect(selections).toStrictEqual([
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
        expect(selections).toStrictEqual([
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
        expect(selected).toStrictEqual({
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
});
