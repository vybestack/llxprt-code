/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

// This test needs real config files, not the global mock
vi.unmock('./providerAliases.js');

import { loadProviderAliasEntries } from './providerAliases.js';

describe('Provider Alias Static Models (Issue #1206)', () => {
  describe('qwen alias', () => {
    it('should have staticModels defined with qwen3-coder-plus', () => {
      const entries = loadProviderAliasEntries();
      const qwenEntry = entries.find((e) => e.alias === 'qwen');

      expect(qwenEntry).toBeDefined();
      expect(qwenEntry?.config.staticModels).toBeDefined();
      expect(qwenEntry?.config.staticModels).toBeInstanceOf(Array);
      expect(qwenEntry?.config.staticModels?.length).toBeGreaterThan(0);

      const hasQwenModel = qwenEntry?.config.staticModels?.some(
        (m) => m.id === 'qwen3-coder-plus',
      );
      expect(hasQwenModel).toBe(true);
    });

    it('should have defaultModel matching a staticModels entry', () => {
      const entries = loadProviderAliasEntries();
      const qwenEntry = entries.find((e) => e.alias === 'qwen');

      expect(qwenEntry).toBeDefined();
      expect(qwenEntry?.config.defaultModel).toBeDefined();

      const defaultModelInList = qwenEntry?.config.staticModels?.some(
        (m) => m.id === qwenEntry?.config.defaultModel,
      );
      expect(defaultModelInList).toBe(true);
    });
  });

  describe('qwenvercel alias', () => {
    it('should have staticModels defined with qwen3-coder-plus', () => {
      const entries = loadProviderAliasEntries();
      const qwenVercelEntry = entries.find((e) => e.alias === 'qwenvercel');

      expect(qwenVercelEntry).toBeDefined();
      expect(qwenVercelEntry?.config.staticModels).toBeDefined();
      expect(qwenVercelEntry?.config.staticModels).toBeInstanceOf(Array);
      expect(qwenVercelEntry?.config.staticModels?.length).toBeGreaterThan(0);

      const hasQwenModel = qwenVercelEntry?.config.staticModels?.some(
        (m) => m.id === 'qwen3-coder-plus',
      );
      expect(hasQwenModel).toBe(true);
    });
  });

  describe('aliases without staticModels', () => {
    it('should not have staticModels for OpenRouter (uses API)', () => {
      const entries = loadProviderAliasEntries();
      const openrouterEntry = entries.find((e) => e.alias === 'OpenRouter');

      expect(openrouterEntry).toBeDefined();
      // OpenRouter should NOT have staticModels - it fetches from API
      expect(openrouterEntry?.config.staticModels).toBeUndefined();
    });

    it('should not have staticModels for mistral (uses API)', () => {
      const entries = loadProviderAliasEntries();
      const mistralEntry = entries.find((e) => e.alias === 'mistral');

      expect(mistralEntry).toBeDefined();
      // mistral should NOT have staticModels - it fetches from API
      expect(mistralEntry?.config.staticModels).toBeUndefined();
    });
  });
});
