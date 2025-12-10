/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  withFuzzyFilter,
  filterCompletions,
  filterStrings,
  getFuzzyEnabled,
} from './fuzzyFilter.js';
import type {
  Option,
  CompleterFn,
  TokenInfo,
} from '../commands/schema/types.js';
import type { CommandContext } from '../commands/types.js';

describe('fuzzyFilter', () => {
  describe('filterCompletions', () => {
    const mockOptions: readonly Option[] = [
      { value: 'production', description: 'Production environment' },
      { value: 'development', description: 'Development environment' },
      { value: 'staging', description: 'Staging environment' },
      { value: 'prod-backup', description: 'Production backup' },
      { value: 'dev-profile', description: 'Development profile' },
    ];

    it('returns all items when query is empty', () => {
      const result = filterCompletions(mockOptions, '', { enableFuzzy: true });
      expect(result).toHaveLength(5);
      expect(result).toEqual(mockOptions);
    });

    it('performs fuzzy matching when enabled', () => {
      const result = filterCompletions(mockOptions, 'prd', {
        enableFuzzy: true,
      });
      // Should match "production" and "prod-backup"
      expect(result.length).toBeGreaterThan(0);
      const values = result.map((r) => r.value);
      expect(values).toContain('production');
      expect(values).toContain('prod-backup');
    });

    it('performs exact prefix matching when fuzzy disabled', () => {
      const result = filterCompletions(mockOptions, 'dev', {
        enableFuzzy: false,
      });
      // Should match "development" and "dev-profile" (prefix match)
      expect(result.length).toBe(2);
      const values = result.map((r) => r.value);
      expect(values).toContain('development');
      expect(values).toContain('dev-profile');
      expect(values).not.toContain('production');
    });

    it('returns empty array when no matches found', () => {
      const result = filterCompletions(mockOptions, 'xyz', {
        enableFuzzy: true,
      });
      expect(result).toEqual([]);
    });

    it('is case insensitive', () => {
      const result = filterCompletions(mockOptions, 'PRD', {
        enableFuzzy: true,
      });
      expect(result.length).toBeGreaterThan(0);
      const values = result.map((r) => r.value);
      expect(values).toContain('production');
    });

    it('preserves Option objects correctly', () => {
      const result = filterCompletions(mockOptions, 'prod', {
        enableFuzzy: true,
      });
      expect(result.length).toBeGreaterThan(0);
      result.forEach((option) => {
        expect(option).toHaveProperty('value');
        expect(option).toHaveProperty('description');
      });
    });

    it('defaults to fuzzy matching when enableFuzzy not specified', () => {
      const result = filterCompletions(mockOptions, 'prd', {});
      expect(result.length).toBeGreaterThan(0);
      const values = result.map((r) => r.value);
      expect(values).toContain('production');
    });
  });

  describe('filterStrings', () => {
    const testStrings = [
      'temperature',
      'max_tokens',
      'top_p',
      'custom-headers',
      'context-limit',
    ];

    it('returns all items when query is empty', () => {
      const result = filterStrings(testStrings, '', { enableFuzzy: true });
      expect(result).toHaveLength(5);
      expect(result).toEqual(testStrings);
    });

    it('performs fuzzy matching when enabled', () => {
      const result = filterStrings(testStrings, 'tmp', { enableFuzzy: true });
      // Should match "temperature" fuzzy
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('temperature');
    });

    it('performs exact prefix matching when fuzzy disabled', () => {
      const result = filterStrings(testStrings, 'top', { enableFuzzy: false });
      expect(result).toEqual(['top_p']);
    });

    it('returns empty array when no matches found', () => {
      const result = filterStrings(testStrings, 'xyz', { enableFuzzy: true });
      expect(result).toEqual([]);
    });

    it('is case insensitive', () => {
      const result = filterStrings(testStrings, 'TEMP', { enableFuzzy: true });
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('temperature');
    });
  });

  describe('getFuzzyEnabled', () => {
    it('returns true when setting is true', () => {
      const ctx = {
        services: {
          settings: {
            merged: {
              enableFuzzyFiltering: true,
            },
          },
        },
      } as unknown as CommandContext;
      expect(getFuzzyEnabled(ctx)).toBe(true);
    });

    it('returns false when setting is false', () => {
      const ctx = {
        services: {
          settings: {
            merged: {
              enableFuzzyFiltering: false,
            },
          },
        },
      } as unknown as CommandContext;
      expect(getFuzzyEnabled(ctx)).toBe(false);
    });

    it('returns true when setting is undefined (default)', () => {
      const ctx = {
        services: {
          settings: {
            merged: {
              enableFuzzyFiltering: undefined,
            },
          },
        },
      } as unknown as CommandContext;
      expect(getFuzzyEnabled(ctx)).toBe(true);
    });

    it('returns true when settings is undefined', () => {
      const ctx = {
        services: {},
      } as unknown as CommandContext;
      expect(getFuzzyEnabled(ctx)).toBe(true);
    });
  });

  describe('withFuzzyFilter', () => {
    let mockContext: CommandContext;
    let mockTokens: TokenInfo;

    beforeEach(() => {
      mockContext = {
        services: {
          settings: {
            merged: {
              enableFuzzyFiltering: true, // enableFuzzyFiltering default
            },
          },
        },
      } as unknown as CommandContext;

      mockTokens = {
        tokens: [],
        partialToken: '',
        hasTrailingSpace: false,
        position: 0,
      };
    });

    it('wraps completer function and applies fuzzy filtering', async () => {
      const baseCompleter: CompleterFn = async () => [
        { value: 'production' },
        { value: 'development' },
        { value: 'staging' },
      ];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(mockContext, 'dev', mockTokens);

      expect(result.length).toBeGreaterThan(0);
      const values = result.map((r) => r.value);
      expect(values).toContain('development');
    });

    it('returns all items when partial is empty', async () => {
      const baseCompleter: CompleterFn = async () => [
        { value: 'production' },
        { value: 'development' },
        { value: 'staging' },
      ];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(mockContext, '', mockTokens);

      expect(result).toHaveLength(3);
    });

    it('uses exact prefix matching when fuzzy filtering disabled', async () => {
      // Update the mock to disable fuzzy filtering
      mockContext = {
        services: {
          settings: {
            merged: {
              enableFuzzyFiltering: false,
            },
          },
        },
      } as unknown as CommandContext;

      const baseCompleter: CompleterFn = async () => [
        { value: 'production' },
        { value: 'development' },
        { value: 'dev-profile' },
      ];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(mockContext, 'dev', mockTokens);

      expect(result.length).toBe(2);
      const values = result.map((r) => r.value);
      expect(values).toContain('development');
      expect(values).toContain('dev-profile');
      expect(values).not.toContain('production');
    });

    it('defaults to fuzzy when setting does not exist', async () => {
      // Mock with undefined setting
      mockContext = {
        services: {
          settings: {
            merged: {
              enableFuzzyFiltering: undefined,
            },
          },
        },
      } as unknown as CommandContext;

      const baseCompleter: CompleterFn = async () => [
        { value: 'production' },
        { value: 'staging' },
      ];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(mockContext, 'prd', mockTokens);

      // Should still do fuzzy matching
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles completer that returns empty array', async () => {
      const baseCompleter: CompleterFn = async () => [];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(mockContext, 'test', mockTokens);

      expect(result).toEqual([]);
    });

    it('preserves description fields from original options', async () => {
      const baseCompleter: CompleterFn = async () => [
        { value: 'production', description: 'Production env' },
        { value: 'development', description: 'Development env' },
      ];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(mockContext, 'dev', mockTokens);

      expect(result.length).toBeGreaterThan(0);
      result.forEach((option) => {
        expect(option).toHaveProperty('description');
      });
    });

    it('handles context without settings service gracefully', async () => {
      const contextWithoutSettings = {
        services: {},
      } as unknown as CommandContext;

      const baseCompleter: CompleterFn = async () => [
        { value: 'production' },
        { value: 'development' },
      ];

      const wrappedCompleter = withFuzzyFilter(baseCompleter);
      const result = await wrappedCompleter(
        contextWithoutSettings,
        'prd',
        mockTokens,
      );

      // Should default to fuzzy and work
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
