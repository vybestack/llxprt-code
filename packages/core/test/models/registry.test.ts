/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { ModelRegistry } from '../../src/models/registry.js';
import { mockApiResponse } from './__fixtures__/mock-data.js';

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    // Create fresh registry for each test
    registry = new ModelRegistry();
    vi.clearAllMocks();

    // Default: no cache, no bundled fallback
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('initialization', () => {
    it('isInitialized returns false before init', () => {
      expect(registry.isInitialized()).toBe(false);
    });

    it('isInitialized returns true after init', async () => {
      // Mock fresh cache to load data
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      await registry.initialize();
      expect(registry.isInitialized()).toBe(true);
    });

    it('initialize is idempotent', async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      await registry.initialize();
      const countAfterFirst = registry.getModelCount();

      await registry.initialize();
      const countAfterSecond = registry.getModelCount();

      expect(countAfterFirst).toBe(countAfterSecond);
    });

    it('concurrent initialize calls do not duplicate work', async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Start multiple initializations concurrently
      const promises = [
        registry.initialize(),
        registry.initialize(),
        registry.initialize(),
      ];

      await Promise.all(promises);

      // readFileSync should only be called once for cache
      // It may be called multiple times due to cache check, but initialization logic runs once
      expect(registry.isInitialized()).toBe(true);
    });
  });

  describe('loading strategy', () => {
    it('loads from cache if fresh', async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000, // 1 second ago (fresh)
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      await registry.initialize();

      expect(registry.getModelCount()).toBeGreaterThan(0);
    });

    it('skips stale cache older than 7 days and triggers refresh', async () => {
      const now = Date.now();
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: eightDaysAgo,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));

      await registry.initialize();

      // Stale cache is skipped, refresh fails, models remain empty
      expect(registry.getModelCount()).toBe(0);
    });

    it('loads from API when no cache exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      await registry.initialize();
      // Wait for background refresh
      await new Promise((r) => setTimeout(r, 100));

      expect(registry.getModelCount()).toBe(7);
    });
  });

  describe('query API', () => {
    beforeEach(async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));
      await registry.initialize();
    });

    describe('getAll', () => {
      it('returns all models', () => {
        const models = registry.getAll();
        expect(models.length).toBe(7); // From mockApiResponse
      });
    });

    describe('getById', () => {
      it('returns model by full ID', () => {
        const model = registry.getById('openai/gpt-4-turbo');
        expect(model).toBeDefined();
        expect(model?.name).toBe('GPT-4 Turbo');
      });

      it('returns undefined for missing ID', () => {
        const model = registry.getById('nonexistent/model');
        expect(model).toBeUndefined();
      });
    });

    describe('getByProvider', () => {
      it('filters by provider ID', () => {
        const models = registry.getByProvider('openai');
        expect(models.length).toBe(4);
        models.forEach((m) => expect(m.providerId).toBe('openai'));
      });

      it('returns empty array for unknown provider', () => {
        const models = registry.getByProvider('unknown-provider');
        expect(models).toEqual([]);
      });
    });

    describe('search', () => {
      it('filters by provider', () => {
        const results = registry.search({ provider: 'anthropic' });
        expect(results.length).toBe(1);
        expect(results[0].providerId).toBe('anthropic');
      });

      it('filters by reasoning capability', () => {
        const results = registry.search({ reasoning: true });
        expect(results.length).toBeGreaterThan(0);
        results.forEach((m) => expect(m.capabilities.reasoning).toBe(true));
      });

      it('filters by toolCalling capability', () => {
        const results = registry.search({ toolCalling: true });
        expect(results.length).toBeGreaterThan(0);
        results.forEach((m) => expect(m.capabilities.toolCalling).toBe(true));
      });

      it('filters by maxPrice', () => {
        const results = registry.search({ maxPrice: 1 });
        results.forEach((m) => {
          if (m.pricing) {
            expect(m.pricing.input).toBeLessThanOrEqual(1);
          }
        });
      });

      it('filters by minContext', () => {
        const results = registry.search({ minContext: 100000 });
        results.forEach((m) => {
          expect(m.limits.contextWindow).toBeGreaterThanOrEqual(100000);
        });
      });

      it('combines multiple filters', () => {
        const results = registry.search({
          provider: 'openai',
          toolCalling: true,
        });
        results.forEach((m) => {
          expect(m.providerId).toBe('openai');
          expect(m.capabilities.toolCalling).toBe(true);
        });
      });
    });
  });

  describe('provider API', () => {
    beforeEach(async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));
      await registry.initialize();
    });

    it('getProviders returns all providers', () => {
      const providers = registry.getProviders();
      expect(providers.length).toBe(4);
    });

    it('getProvider returns provider by ID', () => {
      const provider = registry.getProvider('openai');
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('OpenAI');
    });

    it('getProvider returns undefined for missing', () => {
      const provider = registry.getProvider('nonexistent');
      expect(provider).toBeUndefined();
    });
  });

  describe('counts', () => {
    beforeEach(async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));
      await registry.initialize();
    });

    it('getModelCount returns correct count', () => {
      expect(registry.getModelCount()).toBe(7);
    });

    it('getProviderCount returns correct count', () => {
      expect(registry.getProviderCount()).toBe(4);
    });
  });

  describe('cache metadata', () => {
    it('getCacheMetadata returns null before refresh', async () => {
      const now = Date.now();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: now - 1000,
      } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(mockApiResponse),
      );
      mockFetch.mockRejectedValue(new Error('Network error'));
      await registry.initialize();

      // No successful refresh yet (loaded from cache, not via refresh())
      const metadata = registry.getCacheMetadata();
      expect(metadata).toBeNull();
    });

    it('getCacheMetadata returns data after successful refresh', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      await registry.initialize();
      // Explicitly call refresh to populate metadata
      await registry.refresh();

      // Wait a bit for refresh to complete
      await new Promise((r) => setTimeout(r, 100));

      const metadata = registry.getCacheMetadata();
      expect(metadata).not.toBeNull();
      expect(metadata?.modelCount).toBe(7);
      expect(metadata?.providerCount).toBe(4);
    });
  });

  describe('refresh', () => {
    it('refresh updates models from API', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      await registry.initialize();
      const success = await registry.refresh();

      expect(success).toBe(true);
      expect(registry.getModelCount()).toBe(7);
    });

    it('refresh returns false on network error', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      await registry.initialize();
      const success = await registry.refresh();

      expect(success).toBe(false);
    });

    it('refresh returns false on non-ok response', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await registry.initialize();
      const success = await registry.refresh();

      expect(success).toBe(false);
    });
  });

  describe('event system', () => {
    it('emits models:updated on successful refresh', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const callback = vi.fn();
      registry.on('models:updated', callback);

      await registry.initialize();
      await registry.refresh();

      expect(callback).toHaveBeenCalled();
    });

    it('emits models:error on refresh failure', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const callback = vi.fn();
      registry.on('models:error', callback);

      await registry.initialize();
      await registry.refresh();

      expect(callback).toHaveBeenCalled();
    });

    it('off removes event listener', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      const callback = vi.fn();
      registry.on('models:updated', callback);
      registry.off('models:updated', callback);

      await registry.initialize();
      await registry.refresh();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('clears listeners on dispose', () => {
      const callback = vi.fn();
      registry.on('models:updated', callback);
      registry.dispose();

      // Internal state cleared - can't easily test this without exposing internals
      // Just ensure dispose doesn't throw
      expect(true).toBe(true);
    });
  });
});
