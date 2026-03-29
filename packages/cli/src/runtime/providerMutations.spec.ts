/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260320-ISSUE1575.P03
 * Unit tests for providerMutations.ts pure functions
 */

import { describe, it, expect } from 'vitest';
import {
  computeModelDefaults,
  normalizeProviderBaseUrl,
} from './providerMutations.js';
import type { ModelDefaultRule } from '../providers/providerAliases.js';

describe('providerMutations', () => {
  describe('computeModelDefaults', () => {
    it('returns empty object when no rules match model name', () => {
      const rules: ModelDefaultRule[] = [
        { pattern: 'gpt', ephemeralSettings: { temp: 0.7 } },
      ];
      const result = computeModelDefaults('claude-3', rules);
      expect(result).toEqual({});
    });

    it('matches rules case-insensitively', () => {
      const rules: ModelDefaultRule[] = [
        { pattern: 'GPT', ephemeralSettings: { temp: 0.7 } },
      ];
      const result = computeModelDefaults('gpt-4o', rules);
      expect(result).toEqual({ temp: 0.7 });
    });

    it('later rules override earlier for same key', () => {
      const rules: ModelDefaultRule[] = [
        { pattern: 'gpt', ephemeralSettings: { temp: 0.5 } },
        { pattern: 'gpt-4', ephemeralSettings: { temp: 0.7 } },
      ];
      const result = computeModelDefaults('gpt-4o', rules);
      expect(result).toEqual({ temp: 0.7 });
    });

    it('multiple rules contribute different keys', () => {
      const rules: ModelDefaultRule[] = [
        { pattern: 'gpt', ephemeralSettings: { temp: 0.5 } },
        { pattern: '4o', ephemeralSettings: { top_p: 0.9 } },
      ];
      const result = computeModelDefaults('gpt-4o', rules);
      expect(result).toEqual({ temp: 0.5, top_p: 0.9 });
    });

    it('merges all matching rules', () => {
      const rules: ModelDefaultRule[] = [
        { pattern: 'gpt', ephemeralSettings: { temp: 0.5, streaming: true } },
        { pattern: 'gpt-4', ephemeralSettings: { temp: 0.7 } },
        { pattern: '4o', ephemeralSettings: { top_p: 0.9 } },
      ];
      const result = computeModelDefaults('gpt-4o', rules);
      expect(result).toEqual({ temp: 0.7, streaming: true, top_p: 0.9 });
    });
  });

  describe('normalizeProviderBaseUrl', () => {
    it('preserves trailing slash (implementation does not strip)', () => {
      // Note: The actual implementation preserves trailing slashes
      expect(normalizeProviderBaseUrl('https://api.openai.com/')).toBe(
        'https://api.openai.com/',
      );
    });

    it('passes through URLs without trailing slash unchanged', () => {
      expect(normalizeProviderBaseUrl('https://api.openai.com')).toBe(
        'https://api.openai.com',
      );
    });

    it('preserves trailing slash on URLs with paths', () => {
      // Note: The actual implementation preserves trailing slashes
      expect(normalizeProviderBaseUrl('https://api.example.com/v1/')).toBe(
        'https://api.example.com/v1/',
      );
    });

    it('returns undefined for null/undefined input', () => {
      expect(normalizeProviderBaseUrl(null)).toBeUndefined();
      expect(normalizeProviderBaseUrl()).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalizeProviderBaseUrl('')).toBeUndefined();
    });

    it('returns undefined for "none" keyword (case-insensitive)', () => {
      expect(normalizeProviderBaseUrl('none')).toBeUndefined();
      expect(normalizeProviderBaseUrl('NONE')).toBeUndefined();
      expect(normalizeProviderBaseUrl('None')).toBeUndefined();
    });

    it('trims whitespace', () => {
      expect(normalizeProviderBaseUrl('  https://api.openai.com  ')).toBe(
        'https://api.openai.com',
      );
    });
  });

  // Note: extractProviderBaseUrl tests would require mocking provider objects
  // and are better suited for integration tests or more complex unit test setups.
  // For Phase 3, we're focusing on the most critical pure functions.
});
