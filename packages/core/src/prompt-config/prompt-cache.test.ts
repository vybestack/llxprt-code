/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptCache, CacheEntry } from './prompt-cache.js';
import { PromptContext } from './types.js';

describe('PromptCache', () => {
  let cache: PromptCache;

  const createContext = (
    overrides: Partial<PromptContext> = {},
  ): PromptContext => ({
    provider: 'anthropic',
    model: 'claude-3',
    enabledTools: ['read', 'write'],
    environment: {
      isGitRepository: true,
      isSandboxed: false,
      hasIdeCompanion: true,
    },
    ...overrides,
  });

  const createMetadata = (
    overrides: Partial<CacheEntry['metadata']> = {},
  ): CacheEntry['metadata'] => ({
    files: ['test.txt'],
    tokenCount: 100,
    assemblyTimeMs: 50,
    ...overrides,
  });

  beforeEach(() => {
    cache = new PromptCache(10); // 10MB cache
  });

  describe('constructor', () => {
    it('should initialize with default size when no size provided', () => {
      const defaultCache = new PromptCache();
      const stats = defaultCache.getStats();
      expect(stats.maxSizeMB).toBe(100); // Default 100MB
    });

    it('should enforce minimum size of 100MB for invalid sizes', () => {
      const zeroCache = new PromptCache(0);
      const stats = zeroCache.getStats();
      expect(stats.maxSizeMB).toBe(100);
    });

    it('should enforce maximum size of 1000MB', () => {
      const largeCache = new PromptCache(2000);
      const stats = largeCache.getStats();
      expect(stats.maxSizeMB).toBe(1000);
    });
  });

  describe('generateKey', () => {
    it('should generate consistent keys for same context', () => {
      const context = createContext();
      const key1 = cache.generateKey(context);
      const key2 = cache.generateKey(context);
      expect(key1).toBe(key2);
    });

    it('should include provider and model in key', () => {
      const context = createContext({
        provider: 'openai',
        model: 'gpt-4',
      });
      const key = cache.generateKey(context);
      expect(key).toContain('openai');
      expect(key).toContain('gpt-4');
    });

    it('should include sorted tools in key', () => {
      const context = createContext({
        enabledTools: ['write', 'read', 'grep'],
      });
      const key = cache.generateKey(context);
      // Tools should be sorted alphabetically
      expect(key).toContain('grep');
      expect(key).toContain('read');
      expect(key).toContain('write');
    });

    it('should include environment flags in key', () => {
      const context = createContext({
        environment: {
          isGitRepository: true,
          isSandboxed: true,
          hasIdeCompanion: false,
        },
        includeSubagentDelegation: true,
      });
      const key = cache.generateKey(context);
      expect(key).toContain('git');
      expect(key).toContain('sandbox');
      expect(key).toContain('subagent-delegation');
      expect(key).not.toContain('ide');
    });

    it('should include no-subagent-delegation flag when disabled', () => {
      const context = createContext({ includeSubagentDelegation: false });
      const key = cache.generateKey(context);
      expect(key).toContain('no-subagent-delegation');
    });

    it('should omit delegation flags when undefined', () => {
      const context = createContext({ includeSubagentDelegation: undefined });
      const key = cache.generateKey(context);
      expect(key).not.toContain('no-subagent-delegation');
      expect(key).not.toContain('subagent-delegation');
    });

    it('should handle null or undefined context', () => {
      const key = cache.generateKey(null as unknown as PromptContext);
      expect(key).toBe('');
    });

    it('should handle missing context properties with defaults', () => {
      const partialContext = {
        provider: 'test',
      } as PromptContext;
      const key = cache.generateKey(partialContext);
      expect(key).toContain('test');
      expect(key).toContain('unknown'); // Default model
    });

    it('should generate different keys for different contexts', () => {
      const context1 = createContext({ provider: 'openai' });
      const context2 = createContext({ provider: 'anthropic' });
      const key1 = cache.generateKey(context1);
      const key2 = cache.generateKey(context2);
      expect(key1).not.toBe(key2);
    });
  });

  describe('set and get operations', () => {
    it('should store and retrieve a prompt', () => {
      const context = createContext();
      const prompt = 'Test prompt content';
      const metadata = createMetadata();

      cache.set(context, prompt, metadata);
      const result = cache.get(context);

      expect(result).not.toBeNull();
      expect(result!.assembledPrompt).toBe(prompt);
      expect(result!.metadata.files).toEqual(metadata.files);
      expect(result!.metadata.tokenCount).toBe(metadata.tokenCount);
      expect(result!.metadata.assemblyTimeMs).toBe(metadata.assemblyTimeMs);
    });

    it('should return null for non-existent entries', () => {
      const context = createContext();
      const result = cache.get(context);
      expect(result).toBeNull();
    });

    it('should update access count and time on get', () => {
      const context = createContext();
      const prompt = 'Test prompt';
      const metadata = createMetadata();

      cache.set(context, prompt, metadata);

      // First access
      cache.get(context);
      // Second access
      cache.get(context);

      const stats = cache.getStats();
      expect(stats.totalAccesses).toBe(2);
    });

    it('should handle null or empty keys in set', () => {
      const prompt = 'Test prompt';
      const metadata = createMetadata();

      // Should not throw, but operation should fail
      cache.set(null as unknown as PromptContext, prompt, metadata);
      expect(cache.size()).toBe(0);
    });

    it('should handle null content in set', () => {
      const context = createContext();
      const metadata = createMetadata();

      cache.set(context, null as unknown as string, metadata);
      expect(cache.has(context)).toBe(false);
    });

    it('should reject content larger than cache size', () => {
      const context = createContext();
      const largePrompt = 'x'.repeat(11 * 1024 * 1024); // 11MB
      const metadata = createMetadata();

      cache.set(context, largePrompt, metadata);
      expect(cache.has(context)).toBe(false);
    });

    it('should overwrite existing entries', () => {
      const context = createContext();
      const prompt1 = 'First prompt';
      const prompt2 = 'Second prompt';
      const metadata = createMetadata();

      cache.set(context, prompt1, metadata);
      cache.set(context, prompt2, metadata);

      const result = cache.get(context);
      expect(result!.assembledPrompt).toBe(prompt2);
    });
  });

  describe('has operation', () => {
    it('should return true for existing entries', () => {
      const context = createContext();
      cache.set(context, 'Test prompt', createMetadata());
      expect(cache.has(context)).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      const context = createContext();
      expect(cache.has(context)).toBe(false);
    });

    it('should handle null or empty keys', () => {
      expect(cache.has(null as unknown as PromptContext)).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when cache is full', () => {
      const smallCache = new PromptCache(0.001); // 1KB cache

      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });
      const context3 = createContext({ model: 'model3' });

      // Each prompt is ~500 bytes
      const prompt = 'x'.repeat(500);
      const metadata = createMetadata();

      // Add first two entries
      smallCache.set(context1, prompt, metadata);
      smallCache.set(context2, prompt, metadata);

      // Access first entry to make it more recent
      smallCache.get(context1);

      // Add third entry - should evict context2
      smallCache.set(context3, prompt, metadata);

      expect(smallCache.has(context1)).toBe(true);
      expect(smallCache.has(context2)).toBe(false); // Evicted
      expect(smallCache.has(context3)).toBe(true);
    });

    it('should handle eviction of multiple entries to make room', () => {
      const smallCache = new PromptCache(0.002); // 2KB cache

      // Add several small entries
      for (let i = 0; i < 10; i++) {
        const context = createContext({ model: `model${i}` });
        smallCache.set(context, 'x'.repeat(200), createMetadata());
      }

      // Add one large entry that requires evicting multiple entries
      const largeContext = createContext({ model: 'large' });
      smallCache.set(largeContext, 'x'.repeat(1500), createMetadata());

      expect(smallCache.has(largeContext)).toBe(true);
      expect(smallCache.size()).toBeLessThan(10); // Some entries were evicted
    });

    it('should update access order on get operations', () => {
      const smallCache = new PromptCache(0.001); // 1KB cache

      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });
      const context3 = createContext({ model: 'model3' });

      const prompt = 'x'.repeat(400);
      const metadata = createMetadata();

      smallCache.set(context1, prompt, metadata);
      smallCache.set(context2, prompt, metadata);

      // Access context1 multiple times
      smallCache.get(context1);
      smallCache.get(context1);

      // Add context3 - should evict context2, not context1
      smallCache.set(context3, prompt, metadata);

      expect(smallCache.has(context1)).toBe(true);
      expect(smallCache.has(context2)).toBe(false);
      expect(smallCache.has(context3)).toBe(true);
    });
  });

  describe('remove operation', () => {
    it('should remove existing entries', () => {
      const context = createContext();
      cache.set(context, 'Test prompt', createMetadata());

      const key = cache.generateKey(context);
      const removed = cache.remove(key);

      expect(removed).toBe(true);
      expect(cache.has(context)).toBe(false);
    });

    it('should return false for non-existent entries', () => {
      const removed = cache.remove('non-existent-key');
      expect(removed).toBe(false);
    });

    it('should handle null or empty keys', () => {
      expect(cache.remove('')).toBe(false);
      expect(cache.remove(null as unknown as string)).toBe(false);
    });

    it('should update cache size after removal', () => {
      const context = createContext();
      const prompt = 'x'.repeat(1000);
      cache.set(context, prompt, createMetadata());

      const statsBefore = cache.getStats();
      expect(statsBefore.totalSizeMB).toBeGreaterThan(0);

      const key = cache.generateKey(context);
      cache.remove(key);

      const statsAfter = cache.getStats();
      expect(statsAfter.totalSizeMB).toBe(0);
    });
  });

  describe('clear operation', () => {
    it('should remove all entries', () => {
      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });

      cache.set(context1, 'Prompt 1', createMetadata());
      cache.set(context2, 'Prompt 2', createMetadata());

      expect(cache.size()).toBe(2);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has(context1)).toBe(false);
      expect(cache.has(context2)).toBe(false);
    });

    it('should reset cache statistics', () => {
      const context = createContext();
      cache.set(context, 'Test prompt', createMetadata());
      cache.get(context);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.totalSizeMB).toBe(0);
      expect(stats.totalAccesses).toBe(0);
    });
  });

  describe('size operation', () => {
    it('should return correct entry count', () => {
      expect(cache.size()).toBe(0);

      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });

      cache.set(context1, 'Prompt 1', createMetadata());
      expect(cache.size()).toBe(1);

      cache.set(context2, 'Prompt 2', createMetadata());
      expect(cache.size()).toBe(2);
    });
  });

  describe('getStats operation', () => {
    it('should return correct cache statistics', () => {
      const stats = cache.getStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.totalSizeMB).toBe(0);
      expect(stats.maxSizeMB).toBe(10);
      expect(stats.utilizationPercent).toBe(0);
      expect(stats.averageEntrySizeKB).toBe(0);
      expect(stats.totalAccesses).toBe(0);
      expect(stats.mostAccessedKey).toBeNull();
      expect(stats.mostAccessedCount).toBe(0);
    });

    it('should track access patterns correctly', () => {
      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });

      cache.set(context1, 'Prompt 1', createMetadata());
      cache.set(context2, 'Prompt 2', createMetadata());

      // Access context1 more times
      cache.get(context1);
      cache.get(context1);
      cache.get(context1);
      cache.get(context2);

      const stats = cache.getStats();
      expect(stats.totalAccesses).toBe(4);
      expect(stats.mostAccessedKey).toBe(cache.generateKey(context1));
      expect(stats.mostAccessedCount).toBe(3);
    });

    it('should calculate utilization and average size correctly', () => {
      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });

      const prompt1 = 'x'.repeat(1000); // 1KB
      const prompt2 = 'x'.repeat(2000); // 2KB

      cache.set(context1, prompt1, createMetadata());
      cache.set(context2, prompt2, createMetadata());

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(2);
      expect(stats.totalSizeMB).toBeCloseTo(0.003, 3);
      expect(stats.utilizationPercent).toBeCloseTo(0.03, 2);
      expect(stats.averageEntrySizeKB).toBeCloseTo(1.5, 1);
    });
  });

  describe('preload operation', () => {
    it('should return count of contexts that would be cached', () => {
      const contexts = [
        createContext({ model: 'model1' }),
        createContext({ model: 'model2' }),
        createContext({ model: 'model3' }),
      ];

      const count = cache.preload(contexts);
      expect(count).toBe(3);
    });

    it('should skip already cached contexts', () => {
      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });

      cache.set(context1, 'Already cached', createMetadata());

      const contexts = [context1, context2];
      const count = cache.preload(contexts);

      expect(count).toBe(1); // Only context2 would be cached
    });

    it('should handle empty or null contexts array', () => {
      expect(cache.preload([])).toBe(0);
      expect(cache.preload(null as unknown as PromptContext[])).toBe(0);
    });

    it('should skip contexts that generate empty keys', () => {
      const contexts = [
        createContext(),
        null as unknown as PromptContext,
        createContext({ model: 'model2' }),
      ];

      const count = cache.preload(contexts);
      expect(count).toBe(2); // Null context is skipped
    });
  });

  describe('edge cases', () => {
    it('should handle zero-size cache gracefully', () => {
      const zeroCache = new PromptCache(0);
      const context = createContext();

      zeroCache.set(context, 'Test', createMetadata());
      expect(zeroCache.has(context)).toBe(false);
      expect(zeroCache.size()).toBe(0);
    });

    it('should handle single entry using entire cache', () => {
      const smallCache = new PromptCache(0.001); // 1KB
      const context = createContext();
      const prompt = 'x'.repeat(900); // Just under 1KB

      smallCache.set(context, prompt, createMetadata());
      expect(smallCache.has(context)).toBe(true);

      // Adding another entry should evict the first
      const context2 = createContext({ model: 'model2' });
      smallCache.set(context2, 'Small prompt', createMetadata());

      expect(smallCache.has(context)).toBe(false);
      expect(smallCache.has(context2)).toBe(true);
    });

    it('should handle rapid access pattern changes', () => {
      const context1 = createContext({ model: 'model1' });
      const context2 = createContext({ model: 'model2' });
      const context3 = createContext({ model: 'model3' });

      cache.set(context1, 'Prompt 1', createMetadata());
      cache.set(context2, 'Prompt 2', createMetadata());
      cache.set(context3, 'Prompt 3', createMetadata());

      // Rapidly change access patterns
      for (let i = 0; i < 10; i++) {
        if (i % 3 === 0) cache.get(context1);
        else if (i % 3 === 1) cache.get(context2);
        else cache.get(context3);
      }

      const stats = cache.getStats();
      expect(stats.totalAccesses).toBe(10);
    });

    it('should maintain metadata immutability', () => {
      const context = createContext();
      const originalMetadata = createMetadata();

      cache.set(context, 'Test prompt', originalMetadata);

      // Modify original metadata
      originalMetadata.files.push('another-file.txt');
      originalMetadata.tokenCount = 999;

      // Retrieved metadata should not be affected
      const result = cache.get(context);
      expect(result!.metadata.files).toEqual(['test.txt']);
      expect(result!.metadata.tokenCount).toBe(100);
    });

    it('should handle concurrent-like access patterns', () => {
      const contexts = Array.from({ length: 10 }, (_, i) =>
        createContext({ model: `model${i}` }),
      );

      // Simulate concurrent-like access
      contexts.forEach((ctx, i) => {
        cache.set(ctx, `Prompt ${i}`, createMetadata());
      });

      // Random access pattern
      for (let i = 0; i < 50; i++) {
        const randomIndex = Math.floor(Math.random() * contexts.length);
        cache.get(contexts[randomIndex]);
      }

      expect(cache.size()).toBe(10);
      const stats = cache.getStats();
      expect(stats.totalAccesses).toBe(50);
    });
  });
});
