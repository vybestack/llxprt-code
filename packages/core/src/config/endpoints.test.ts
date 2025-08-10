/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  validateEndpoint,
  isQwenEndpoint,
  isOpenAIEndpoint,
  shouldUseQwenOAuth,
  generateOAuthEndpointMismatchError,
  getSuggestedEndpoints,
  QWEN_ENDPOINTS,
  OPENAI_ENDPOINTS,
} from './endpoints.js';

describe('Endpoint Validation Utilities', () => {
  describe('validateEndpoint', () => {
    it('should correctly identify Qwen endpoints', () => {
      // Test each known Qwen endpoint
      for (const endpoint of QWEN_ENDPOINTS) {
        const result = validateEndpoint(endpoint);
        expect(result.isQwenEndpoint).toBe(true);
        expect(result.supportsQwenOAuth).toBe(true);
        expect(result.isOpenAIEndpoint).toBe(false);
      }
    });

    it('should correctly identify OpenAI endpoints', () => {
      // Test each known OpenAI endpoint
      for (const endpoint of OPENAI_ENDPOINTS) {
        const result = validateEndpoint(endpoint);
        expect(result.isOpenAIEndpoint).toBe(true);
        expect(result.isQwenEndpoint).toBe(false);
        expect(result.supportsQwenOAuth).toBe(false);
      }
    });

    it('should handle Qwen endpoints with paths', () => {
      const result = validateEndpoint(
        'https://dashscope.aliyuncs.com/api/v1/chat',
      );
      expect(result.isQwenEndpoint).toBe(true);
      expect(result.supportsQwenOAuth).toBe(true);
      expect(result.isOpenAIEndpoint).toBe(false);
    });

    it('should handle OpenAI endpoints with paths', () => {
      const result = validateEndpoint(
        'https://api.openai.com/v1/chat/completions',
      );
      expect(result.isOpenAIEndpoint).toBe(true);
      expect(result.isQwenEndpoint).toBe(false);
      expect(result.supportsQwenOAuth).toBe(false);
    });

    it('should handle custom endpoints (neither Qwen nor OpenAI)', () => {
      const result = validateEndpoint('https://custom-api.example.com/v1');
      expect(result.isQwenEndpoint).toBe(false);
      expect(result.isOpenAIEndpoint).toBe(false);
      expect(result.supportsQwenOAuth).toBe(false);
    });

    it('should normalize URLs by removing trailing slashes', () => {
      const result = validateEndpoint('https://dashscope.aliyuncs.com///');
      expect(result.normalizedBaseURL).toBe('https://dashscope.aliyuncs.com');
      expect(result.isQwenEndpoint).toBe(true);
    });

    it('should handle empty or invalid URLs', () => {
      const result = validateEndpoint('');
      expect(result.isQwenEndpoint).toBe(false);
      expect(result.isOpenAIEndpoint).toBe(false);
      expect(result.supportsQwenOAuth).toBe(false);
      expect(result.normalizedBaseURL).toBe('');
    });
  });

  describe('isQwenEndpoint', () => {
    it('should return true for Qwen endpoints', () => {
      expect(isQwenEndpoint('https://dashscope.aliyuncs.com')).toBe(true);
      expect(isQwenEndpoint('https://api.qwen.com')).toBe(true);
      expect(isQwenEndpoint('https://dashscope.aliyuncs.com/v1')).toBe(true);
    });

    it('should return false for non-Qwen endpoints', () => {
      expect(isQwenEndpoint('https://api.openai.com/v1')).toBe(false);
      expect(isQwenEndpoint('https://custom-api.example.com')).toBe(false);
      expect(isQwenEndpoint('')).toBe(false);
    });
  });

  describe('isOpenAIEndpoint', () => {
    it('should return true for OpenAI endpoints', () => {
      expect(isOpenAIEndpoint('https://api.openai.com/v1')).toBe(true);
      expect(isOpenAIEndpoint('https://api.openai.com')).toBe(true);
    });

    it('should return false for non-OpenAI endpoints', () => {
      expect(isOpenAIEndpoint('https://dashscope.aliyuncs.com')).toBe(false);
      expect(isOpenAIEndpoint('https://custom-api.example.com')).toBe(false);
      expect(isOpenAIEndpoint('')).toBe(false);
    });
  });

  describe('shouldUseQwenOAuth', () => {
    it('should return true for Qwen endpoints when OAuth is enabled', () => {
      expect(shouldUseQwenOAuth('https://dashscope.aliyuncs.com', true)).toBe(
        true,
      );
      expect(shouldUseQwenOAuth('https://api.qwen.com', true)).toBe(true);
    });

    it('should return false for Qwen endpoints when OAuth is disabled', () => {
      expect(shouldUseQwenOAuth('https://dashscope.aliyuncs.com', false)).toBe(
        false,
      );
      expect(shouldUseQwenOAuth('https://api.qwen.com', false)).toBe(false);
    });

    it('should return false for non-Qwen endpoints regardless of OAuth setting', () => {
      expect(shouldUseQwenOAuth('https://api.openai.com/v1', true)).toBe(false);
      expect(shouldUseQwenOAuth('https://api.openai.com/v1', false)).toBe(
        false,
      );
      expect(shouldUseQwenOAuth('https://custom-api.example.com', true)).toBe(
        false,
      );
    });
  });

  describe('generateOAuthEndpointMismatchError', () => {
    it('should generate specific error for OpenAI endpoints with Qwen OAuth', () => {
      const error = generateOAuthEndpointMismatchError(
        'https://api.openai.com/v1',
        'qwen',
      );
      expect(error).toContain('Qwen OAuth is enabled');
      expect(error).toContain('https://api.openai.com/v1');
      expect(error).toContain('OpenAI endpoint');
      expect(error).toContain('use an API key for OpenAI');
      expect(error).toContain('change the baseURL to a Qwen endpoint');
    });

    it('should generate generic error for custom endpoints with Qwen OAuth', () => {
      const error = generateOAuthEndpointMismatchError(
        'https://custom-api.example.com',
        'qwen',
      );
      expect(error).toContain('Qwen OAuth is enabled');
      expect(error).toContain('https://custom-api.example.com');
      expect(error).toContain('not a Qwen endpoint');
      expect(error).toContain('use an API key');
      expect(error).toContain('change the baseURL to a Qwen endpoint');
    });

    it('should generate generic error for unknown OAuth providers', () => {
      const error = generateOAuthEndpointMismatchError(
        'https://api.openai.com/v1',
        'unknown',
      );
      expect(error).toContain("OAuth provider 'unknown'");
      expect(error).toContain('not supported');
      expect(error).toContain('https://api.openai.com/v1');
    });
  });

  describe('getSuggestedEndpoints', () => {
    it('should return Qwen endpoints for qwen provider', () => {
      const suggestions = getSuggestedEndpoints('qwen');
      expect(suggestions).toEqual([...QWEN_ENDPOINTS]);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown providers', () => {
      const suggestions = getSuggestedEndpoints('unknown');
      expect(suggestions).toEqual([]);
    });

    it('should return empty array for empty provider', () => {
      const suggestions = getSuggestedEndpoints('');
      expect(suggestions).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle URLs with unusual formatting', () => {
      // Test URLs with multiple slashes, mixed case, etc.
      const testCases = [
        'HTTPS://DASHSCOPE.ALIYUNCS.COM',
        'https://dashscope.aliyuncs.com///',
        'https://dashscope.aliyuncs.com/v1/',
        'https://api.openai.com/V1/',
      ];

      for (const testUrl of testCases) {
        const result = validateEndpoint(testUrl);
        // Should not throw and should provide some result
        expect(result).toBeDefined();
        expect(typeof result.normalizedBaseURL).toBe('string');
      }
    });

    it('should handle partial URL matches correctly', () => {
      // These should not match as they are not actual subdomains/paths of known endpoints
      expect(isQwenEndpoint('https://not-dashscope.aliyuncs.com')).toBe(false);
      expect(isQwenEndpoint('https://dashscope.aliyuncs.com.evil.com')).toBe(
        false,
      );
      expect(isOpenAIEndpoint('https://fake-api.openai.com')).toBe(false);
    });

    it('should handle case sensitivity appropriately', () => {
      // URLs are typically case-insensitive for domains, but our implementation
      // may be case-sensitive. Document the behavior.
      const lowerResult = validateEndpoint('https://dashscope.aliyuncs.com');

      // Document current behavior - adjust if implementation changes
      expect(lowerResult.isQwenEndpoint).toBe(true);
      // Note: Current implementation may be case-sensitive
    });
  });

  describe('Constants Validation', () => {
    it('should have valid Qwen endpoints defined', () => {
      expect(QWEN_ENDPOINTS).toBeDefined();
      expect(QWEN_ENDPOINTS.length).toBeGreaterThan(0);

      for (const endpoint of QWEN_ENDPOINTS) {
        expect(typeof endpoint).toBe('string');
        expect(endpoint.startsWith('https://')).toBe(true);
      }
    });

    it('should have valid OpenAI endpoints defined', () => {
      expect(OPENAI_ENDPOINTS).toBeDefined();
      expect(OPENAI_ENDPOINTS.length).toBeGreaterThan(0);

      for (const endpoint of OPENAI_ENDPOINTS) {
        expect(typeof endpoint).toBe('string');
        expect(endpoint.startsWith('https://')).toBe(true);
      }
    });

    it('should have no overlap between Qwen and OpenAI endpoints', () => {
      const qwenSet = new Set(QWEN_ENDPOINTS);
      const openaiSet = new Set(OPENAI_ENDPOINTS);

      for (const qwenEndpoint of qwenSet) {
        expect(openaiSet.has(qwenEndpoint as never)).toBe(false);
      }

      for (const openaiEndpoint of openaiSet) {
        expect(qwenSet.has(openaiEndpoint as never)).toBe(false);
      }
    });
  });
});
