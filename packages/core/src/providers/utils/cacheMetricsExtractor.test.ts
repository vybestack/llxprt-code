import { describe, it, expect } from 'vitest';
import { extractCacheMetrics } from './cacheMetricsExtractor';

describe('extractCacheMetrics', () => {
  describe('OpenAI/Groq format', () => {
    it('extracts cached_tokens from prompt_tokens_details', () => {
      const usage = {
        prompt_tokens_details: {
          cached_tokens: 150,
        },
      };

      const result = extractCacheMetrics(usage);

      expect(result).toEqual({
        cachedTokens: 150,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
      });
    });
  });

  describe('Anthropic format', () => {
    it('extracts cache_read_input_tokens and cache_creation_input_tokens', () => {
      const usage = {
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 50,
      };

      const result = extractCacheMetrics(usage);

      expect(result).toEqual({
        cachedTokens: 200,
        cacheCreationTokens: 50,
        cacheMissTokens: 0,
      });
    });
  });

  describe('Deepseek format', () => {
    it('extracts prompt_cache_hit_tokens and prompt_cache_miss_tokens', () => {
      const usage = {
        prompt_cache_hit_tokens: 300,
        prompt_cache_miss_tokens: 100,
      };

      const result = extractCacheMetrics(usage);

      expect(result).toEqual({
        cachedTokens: 300,
        cacheCreationTokens: 0,
        cacheMissTokens: 100,
      });
    });
  });

  describe('Fireworks headers format', () => {
    it('extracts from Headers object', () => {
      const usage = {};
      const headers = new Headers({
        'fireworks-cached-prompt-tokens': '400',
        'fireworks-prompt-tokens': '500',
      });

      const result = extractCacheMetrics(usage, headers);

      expect(result).toEqual({
        cachedTokens: 400,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
      });
    });
  });

  describe('Qwen format', () => {
    it('extracts same as Anthropic format', () => {
      const usage = {
        cache_read_input_tokens: 250,
        cache_creation_input_tokens: 75,
      };

      const result = extractCacheMetrics(usage);

      expect(result).toEqual({
        cachedTokens: 250,
        cacheCreationTokens: 75,
        cacheMissTokens: 0,
      });
    });
  });

  describe('Fallback behavior', () => {
    it('returns zeros when no cache fields present', () => {
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
      };

      const result = extractCacheMetrics(usage);

      expect(result).toEqual({
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
      });
    });
  });

  describe('Null handling', () => {
    it('handles null usage gracefully', () => {
      const result = extractCacheMetrics(null);

      expect(result).toEqual({
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
      });
    });

    it('handles undefined usage gracefully', () => {
      const result = extractCacheMetrics(undefined);

      expect(result).toEqual({
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheMissTokens: 0,
      });
    });
  });

  describe('Priority handling', () => {
    it('prefers prompt_tokens_details.cached_tokens when multiple fields present', () => {
      const usage = {
        prompt_tokens_details: {
          cached_tokens: 100,
        },
        cache_read_input_tokens: 200,
        prompt_cache_hit_tokens: 300,
      };

      const result = extractCacheMetrics(usage);

      expect(result.cachedTokens).toBe(100);
    });

    it('falls back to Anthropic format when OpenAI format not present', () => {
      const usage = {
        cache_read_input_tokens: 200,
        prompt_cache_hit_tokens: 300,
      };

      const result = extractCacheMetrics(usage);

      expect(result.cachedTokens).toBe(200);
    });

    it('falls back to Deepseek format when OpenAI and Anthropic not present', () => {
      const usage = {
        prompt_cache_hit_tokens: 300,
      };

      const result = extractCacheMetrics(usage);

      expect(result.cachedTokens).toBe(300);
    });
  });
});
