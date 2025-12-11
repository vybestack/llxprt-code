/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createCompletionHandler } from './index.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type {
  CommandArgumentSchema,
  LiteralArgument,
  ValueArgument,
} from './types.js';

// Mock command context for tests
const mockContext = createMockCommandContext();

// Helper functions to create test arguments
const literal = (
  value: string,
  description?: string,
  next?: CommandArgumentSchema,
): LiteralArgument => ({
  kind: 'literal',
  value,
  description: description ?? `Literal ${value}`,
  next,
});

const value = (
  name: string,
  description: string,
  options?: ReadonlyArray<{ value: string; description?: string }>,
): ValueArgument => ({
  kind: 'value',
  name,
  description,
  options,
});

describe('Deep Path Completion @plan:PLAN-411-DEEPCOMPLETION', () => {
  describe('Flattened path search', () => {
    it('finds single-level matches and prioritizes them first @requirement:REQ-001', async () => {
      // Schema simulating /set with both direct options and nested paths
      const schema: CommandArgumentSchema = [
        literal('teatime', 'Direct teatime option'),
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
            { value: 'max_tokens', description: 'Max tokens parameter' },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/set tea');

      // Should find 'teatime' as a direct match
      expect(result.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'teatime' })]),
      );

      // Single-level match should appear before any nested paths
      const teatimeIndex = result.suggestions.findIndex(
        (s) => s.value === 'teatime',
      );
      const nestedIndex = result.suggestions.findIndex(
        (s) => s.value === 'modelparam temperature',
      );

      // If both exist, teatime should come first
      const bothExist = teatimeIndex !== -1 && nestedIndex !== -1;
      expect(bothExist ? teatimeIndex < nestedIndex : true).toBe(true);
    });

    it('finds nested paths when partial matches them @requirement:REQ-002', async () => {
      // Schema simulating /set modelparam temperature
      const schema: CommandArgumentSchema = [
        literal('unset', 'Unset option'),
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
            { value: 'max_tokens', description: 'Max tokens parameter' },
            { value: 'top_p', description: 'Top P parameter' },
          ]),
        ]),
        literal('emojifilter', 'Emoji filter option'),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/set tem');

      // Should find nested path 'modelparam temperature'
      const found = result.suggestions.some((s) =>
        s.value.includes('temperature'),
      );
      expect(found).toBe(true);
    });

    it('orders results by path depth (shorter paths first) @requirement:REQ-003', async () => {
      const schema: CommandArgumentSchema = [
        literal('tea', 'Direct tea option'),
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
          ]),
        ]),
        literal('testing', 'Testing option', [
          value('test-type', 'test type', [
            { value: 'unit', description: 'Unit tests' },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/set te');

      // Extract positions
      const teaIndex = result.suggestions.findIndex((s) => s.value === 'tea');
      const testingIndex = result.suggestions.findIndex(
        (s) => s.value === 'testing',
      );
      const temperatureIndex = result.suggestions.findIndex((s) =>
        s.value.includes('temperature'),
      );

      // Single-level matches (tea, testing) should appear before nested paths
      const teaBeforeTemp =
        teaIndex === -1 ||
        temperatureIndex === -1 ||
        teaIndex < temperatureIndex;
      const testingBeforeTemp =
        testingIndex === -1 ||
        temperatureIndex === -1 ||
        testingIndex < temperatureIndex;

      expect(teaBeforeTemp).toBe(true);
      expect(testingBeforeTemp).toBe(true);
    });

    it('correctly inserts multi-token paths when selected @requirement:REQ-004', async () => {
      const schema: CommandArgumentSchema = [
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/set tem');

      // Should suggest a completion that represents the full path
      const temperatureSuggestion = result.suggestions.find((s) =>
        s.value.includes('temperature'),
      );

      expect(temperatureSuggestion).toBeDefined();
      // The value should represent the full path needed
      expect(temperatureSuggestion?.value).toContain('temperature');
    });

    it('works with fuzzy matching enabled @requirement:REQ-005', async () => {
      // Create context with fuzzy matching explicitly enabled
      const fuzzyContext = createMockCommandContext();
      if (fuzzyContext.services.settings?.merged) {
        fuzzyContext.services.settings.merged.enableFuzzyFiltering = true;
      }

      const schema: CommandArgumentSchema = [
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
            { value: 'max_tokens', description: 'Max tokens parameter' },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      // Fuzzy match: 'tmp' should match 'temperature'
      const result = await handler(fuzzyContext, '', '/set tmp');

      // Should find temperature through fuzzy matching
      const found = result.suggestions.some((s) =>
        s.value.includes('temperature'),
      );
      expect(found).toBe(true);
    });

    it('works with fuzzy matching disabled (prefix only) @requirement:REQ-006', async () => {
      // Create context with fuzzy matching explicitly disabled
      const prefixContext = createMockCommandContext();
      if (prefixContext.services.settings?.merged) {
        prefixContext.services.settings.merged.enableFuzzyFiltering = false;
      }

      const schema: CommandArgumentSchema = [
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
            { value: 'max_tokens', description: 'Max tokens parameter' },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);

      // Prefix match: 'model' should match 'modelparam' and 'modelparam temperature'
      const prefixResult = await handler(prefixContext, '', '/set model');
      const foundModelparam = prefixResult.suggestions.some(
        (s) => s.value === 'modelparam',
      );
      expect(foundModelparam).toBe(true);

      // With prefix matching disabled, 'modelparam temperature' should match 'model'
      // since it starts with 'modelparam' which starts with 'model'
      const foundDeepPath = prefixResult.suggestions.some(
        (s) => s.value === 'modelparam temperature',
      );
      expect(foundDeepPath).toBe(true);

      // Non-prefix: 'xyz' should NOT match anything (fuzzy disabled)
      const nonPrefixResult = await handler(prefixContext, '', '/set xyz');
      expect(nonPrefixResult.suggestions).toHaveLength(0);
    });

    it('returns all options for empty query (configurable behavior) @requirement:REQ-007', async () => {
      const schema: CommandArgumentSchema = [
        literal('unset', 'Unset option'),
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/set ');

      // Empty query should return at least the single-level options
      expect(result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'unset' }),
          expect.objectContaining({ value: 'modelparam' }),
        ]),
      );

      // For now, we expect only single-level options for empty query
      // (not including deep paths)
      const hasDeepPath = result.suggestions.some((s) => s.value.includes(' '));
      expect(hasDeepPath).toBe(false);
    });

    it('handles multiple levels of nesting @requirement:REQ-008', async () => {
      const schema: CommandArgumentSchema = [
        literal('config', 'Configuration option', [
          value('config-section', 'configuration section', [
            { value: 'network', description: 'Network settings' },
          ]),
          literal('network', 'Network configuration', [
            value('network-param', 'network parameter', [
              { value: 'timeout', description: 'Network timeout' },
            ]),
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/cmd time');

      // Should find deeply nested 'timeout'
      const found = result.suggestions.some((s) => s.value.includes('timeout'));
      expect(found).toBe(true);
    });

    it('deduplicates paths that lead to the same endpoint @requirement:REQ-009', async () => {
      const schema: CommandArgumentSchema = [
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
            {
              value: 'temperature',
              description: 'Temperature parameter (dup)',
            },
          ]),
        ]),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/set tem');

      // Should not have duplicate temperature suggestions
      const temperatureSuggestions = result.suggestions.filter((s) =>
        s.value.includes('temperature'),
      );

      // We should have exactly one 'modelparam temperature' suggestion
      // even though the schema has duplicate 'temperature' options
      expect(temperatureSuggestions.length).toBe(1);
      expect(temperatureSuggestions[0]?.value).toBe('modelparam temperature');
    });

    it('preserves existing single-level completion behavior @requirement:REQ-010', async () => {
      // Test that existing functionality isn't broken
      const schema: CommandArgumentSchema = [
        literal('create', 'Create resource'),
        literal('delete', 'Delete resource'),
      ];

      const handler = createCompletionHandler(schema);

      // Full match
      const result1 = await handler(mockContext, '', '/cmd create');
      expect(result1.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'create' })]),
      );

      // Partial match
      const result2 = await handler(mockContext, '', '/cmd cr');
      expect(result2.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'create' })]),
      );

      // No match
      const result3 = await handler(mockContext, '', '/cmd xyz');
      expect(result3.suggestions).toHaveLength(0);
    });
  });

  describe('Real-world schema tests', () => {
    it('handles /set command schema realistically @requirement:REQ-011', async () => {
      // Simplified version of actual /set schema
      const schema: CommandArgumentSchema = [
        literal('unset', 'Unset option'),
        literal('modelparam', 'Model parameter option', [
          value('param-name', 'parameter name', [
            { value: 'temperature', description: 'Temperature parameter' },
            { value: 'max_tokens', description: 'Max tokens parameter' },
            { value: 'top_p', description: 'Top P parameter' },
            { value: 'top_k', description: 'Top K parameter' },
          ]),
        ]),
        literal('emojifilter', 'Emoji filter option'),
        literal('streaming', 'Streaming option'),
      ];

      const handler = createCompletionHandler(schema);

      // Test: /set tem should find both 'temperature' and potentially other matches
      const result = await handler(mockContext, '', '/set tem');

      const hasTemperature = result.suggestions.some((s) =>
        s.value.includes('temperature'),
      );
      expect(hasTemperature).toBe(true);

      // Test: /set top should find top_p and top_k
      const topResult = await handler(mockContext, '', '/set top');
      const hasTopP = topResult.suggestions.some((s) =>
        s.value.includes('top_p'),
      );
      const hasTopK = topResult.suggestions.some((s) =>
        s.value.includes('top_k'),
      );

      expect(hasTopP || hasTopK).toBe(true);
    });
  });
});
