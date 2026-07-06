/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import {
  makeMockProvider,
  makeThrowingProvider,
  drain,
} from './loadBalancerTestHelpers.js';

describe('LoadBalancingProvider.getCurrentModel (issue #2379)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  /** Build an LB provider bound to the current providerManager. */
  function createLbProvider(
    lbConfig: LoadBalancingProviderConfig,
  ): LoadBalancingProvider {
    return new LoadBalancingProvider(lbConfig, providerManager);
  }

  /**
   * Route named delegate providers to the given mocks, returning a restore fn.
   * Any name not in the mapping falls through to the original resolver. Uses
   * vi.spyOn so the original implementation is restored cleanly even if a
   * future test forgets to call the returned restore().
   */
  function mockProviderRouting(mapping: Record<string, IProvider>): () => void {
    const original = providerManager.getProviderByName.bind(providerManager);
    const spy = vi
      .spyOn(providerManager, 'getProviderByName')
      .mockImplementation((name: string) => mapping[name] ?? original(name));
    return () => {
      spy.mockRestore();
    };
  }

  const GLM_SUBPROFILES: LoadBalancingProviderConfig['subProfiles'] = [
    { name: 'zai', providerName: 'anthropic', modelId: 'glm-5.2' },
    { name: 'smart', providerName: 'openai', modelId: 'gpt-4' },
  ];

  describe('before any request', () => {
    it('returns the first sub-profile model', () => {
      const provider = createLbProvider({
        profileName: 'glm',
        strategy: 'round-robin',
        subProfiles: GLM_SUBPROFILES,
      });

      expect(provider.getCurrentModel()).toBe('glm-5.2');
    });
  });

  describe('after a round-robin request selects a sub-profile', () => {
    it('returns the selected sub-profile model, matching getStats().lastSelectedModel', async () => {
      const provider = createLbProvider({
        profileName: 'glm',
        strategy: 'round-robin',
        subProfiles: GLM_SUBPROFILES,
      });
      const restore = mockProviderRouting({
        anthropic: makeMockProvider('anthropic'),
        openai: makeMockProvider('openai'),
      });

      try {
        // First request selects 'zai' (round-robin starts at index 0).
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );

        const stats = provider.getStats();
        expect(stats.lastSelected).toBe('zai');
        expect(provider.getCurrentModel()).toBe('glm-5.2');
        expect(provider.getCurrentModel()).toBe(stats.lastSelectedModel);
      } finally {
        restore();
      }
    });

    it('advances to the next sub-profile model after a second request', async () => {
      const provider = createLbProvider({
        profileName: 'glm',
        strategy: 'round-robin',
        subProfiles: GLM_SUBPROFILES,
      });
      const restore = mockProviderRouting({
        anthropic: makeMockProvider('anthropic'),
        openai: makeMockProvider('openai'),
      });

      try {
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );
        // Second request selects 'smart' (round-robin index 1).
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'two' }] }],
          }),
        );

        const stats = provider.getStats();
        expect(stats.lastSelected).toBe('smart');
        expect(provider.getCurrentModel()).toBe('gpt-4');
        expect(provider.getCurrentModel()).toBe(stats.lastSelectedModel);
      } finally {
        restore();
      }
    });
  });

  describe('failover', () => {
    it('returns the second backend model when the first throws before yielding', async () => {
      const provider = createLbProvider({
        profileName: 'glm',
        strategy: 'failover',
        subProfiles: [
          { name: 'primary', providerName: 'broken', modelId: 'broken-model' },
          {
            name: 'secondary',
            providerName: 'anthropic',
            modelId: 'glm-5.2',
          },
        ],
      });
      const restore = mockProviderRouting({
        broken: makeThrowingProvider('broken'),
        anthropic: makeMockProvider('anthropic'),
      });

      try {
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );

        const stats = provider.getStats();
        expect(stats.lastSelected).toBe('secondary');
        expect(provider.getCurrentModel()).toBe('glm-5.2');
      } finally {
        restore();
      }
    });
  });

  describe('sub-profile with no model', () => {
    const NO_MODEL_CONFIG: LoadBalancingProviderConfig = {
      profileName: 'no-model-lb',
      strategy: 'round-robin',
      subProfiles: [{ name: 'no-model', providerName: 'anthropic' }],
    };

    it('returns empty string, never a Gemini default', async () => {
      const provider = createLbProvider(NO_MODEL_CONFIG);
      const restore = mockProviderRouting({
        anthropic: makeMockProvider('anthropic'),
      });

      try {
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );

        const result = provider.getCurrentModel();
        expect(result).toBe('');
        // Guard against the bug: never fall back to a Gemini default.
        expect(result).not.toBe('gemini-2.5-pro');
        // Intentional divergence: getCurrentModel() returns '' for a missing
        // model, while getStats().lastSelectedModel reports null for the same
        // state (statsBuilder maps '' → null). Document it so future callers do
        // not assume the two are interchangeable.
        expect(provider.getStats().lastSelectedModel).toBeNull();
      } finally {
        restore();
      }
    });

    it('returns empty string before any request when no model is configured', () => {
      const provider = createLbProvider(NO_MODEL_CONFIG);

      const result = provider.getCurrentModel();
      expect(result).toBe('');
      expect(result).not.toBe('gemini-2.5-pro');
    });
  });
});
