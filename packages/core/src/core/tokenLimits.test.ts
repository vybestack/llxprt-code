/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { tokenLimit, DEFAULT_TOKEN_LIMIT } from './tokenLimits.js';

describe('tokenLimit', () => {
  describe('Gemini models', () => {
    it('should return correct limit for gemini-1.5-pro', () => {
      expect(tokenLimit('gemini-1.5-pro')).toBe(2_097_152);
    });

    it('should return correct limit for gemini-1.5-flash', () => {
      expect(tokenLimit('gemini-1.5-flash')).toBe(1_048_576);
    });

    it('should return correct limit for gemini-2.0-flash', () => {
      expect(tokenLimit('gemini-2.0-flash')).toBe(1_048_576);
    });
  });

  describe('OpenAI models', () => {
    it('should return correct limit for o3', () => {
      expect(tokenLimit('o3')).toBe(200_000);
    });

    it('should return correct limit for o3-mini', () => {
      expect(tokenLimit('o3-mini')).toBe(200_000);
    });

    it('should return correct limit for o4-mini', () => {
      expect(tokenLimit('o4-mini')).toBe(128_000);
    });

    it('should return correct limit for gpt-4.1', () => {
      expect(tokenLimit('gpt-4.1')).toBe(1_000_000);
    });

    it('should return correct limit for gpt-4o', () => {
      expect(tokenLimit('gpt-4o')).toBe(128_000);
    });

    it('should return correct limit for gpt-4o-mini', () => {
      expect(tokenLimit('gpt-4o-mini')).toBe(128_000);
    });

    it('should return correct limit for o1', () => {
      expect(tokenLimit('o1')).toBe(200_000);
    });

    it('should return correct limit for o1-mini', () => {
      expect(tokenLimit('o1-mini')).toBe(200_000);
    });
  });

  describe('Default behavior', () => {
    it('should return default limit for unknown models', () => {
      expect(tokenLimit('unknown-model')).toBe(DEFAULT_TOKEN_LIMIT);
    });

    it('should return default limit for empty string', () => {
      expect(tokenLimit('')).toBe(DEFAULT_TOKEN_LIMIT);
    });
  });

  describe('Provider-prefixed models', () => {
    it('should handle OpenAI provider prefix', () => {
      expect(tokenLimit('openai:gpt-4o')).toBe(128_000);
      expect(tokenLimit('openai:gpt-4o-mini')).toBe(128_000);
      expect(tokenLimit('openai:o1')).toBe(200_000);
    });

    it('should handle Gemini provider prefix', () => {
      expect(tokenLimit('gemini:gemini-1.5-pro')).toBe(2_097_152);
      expect(tokenLimit('gemini:gemini-1.5-flash')).toBe(1_048_576);
    });
  });
});
