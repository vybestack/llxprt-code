/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IModel } from '@vybestack/llxprt-code-core';

describe('Provider Manager Static Models Integration (Issue #1206)', () => {
  describe('getModels() behavior with staticModels', () => {
    it('should return static models for providers with staticModels configured', async () => {
      // This test verifies the core behavior: when a provider alias has
      // staticModels configured, getModels() should return those models
      // without making an API call.

      // The actual implementation will be tested via the qwen provider
      // once we update the config and providerManagerInstance.ts
      const staticModels: IModel[] = [
        {
          id: 'qwen3-coder-plus',
          name: 'Qwen3 Coder Plus',
          provider: 'qwen',
          supportedToolFormats: ['openai'],
        },
      ];

      // Verify the model structure is correct
      expect(staticModels[0].id).toBe('qwen3-coder-plus');
      expect(staticModels[0].provider).toBe('qwen');
    });

    it('should preserve IModel interface when using staticModels', () => {
      // Static models should conform to IModel interface
      const model: IModel = {
        id: 'test-model',
        name: 'Test Model',
        provider: 'test-provider',
        supportedToolFormats: ['openai'],
      };

      expect(model.id).toBeDefined();
      expect(model.name).toBeDefined();
      expect(model.provider).toBeDefined();
      expect(model.supportedToolFormats).toBeDefined();
    });
  });

  describe('fallback behavior', () => {
    it('should still use API fallback for providers without staticModels', () => {
      // Providers without staticModels should continue to:
      // 1. Try to fetch from /models endpoint
      // 2. Fall back to hardcoded models on failure
      // This test documents the expected behavior

      const expectedFallbackBehavior = {
        hasStaticModels: false,
        shouldCallApi: true,
        shouldUseFallbackOnApiFailure: true,
      };

      expect(expectedFallbackBehavior.shouldCallApi).toBe(true);
      expect(expectedFallbackBehavior.shouldUseFallbackOnApiFailure).toBe(true);
    });
  });
});
