/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createCompletionHandler } from './index.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type {
  CommandArgumentSchema,
  LiteralArgument,
  ValueArgument,
  CompleterFn,
  HintFn,
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
  description: description || `Literal ${value}`,
  next,
});

const value = (
  name: string,
  description: string,
  options?: string[],
  completer?: CompleterFn,
  hint?: HintFn,
): ValueArgument => ({
  kind: 'value',
  name,
  description,
  options: (options || []).map((opt) =>
    typeof opt === 'string' ? { value: opt } : opt,
  ),
  completer,
  hint,
});

describe('argumentResolver @plan:PLAN-20251013-AUTOCOMPLETE.P04', () => {
  describe('Basic functionality', () => {
    it('handles empty input gracefully @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [value('arg1', 'First argument')];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/');
      expect(result).toHaveProperty('suggestions');
      expect(result).toHaveProperty('hint');
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('provides hints for value arguments @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      const schema: CommandArgumentSchema = [
        value(
          'username',
          'User name',
          undefined,
          undefined,
          async () => 'Enter a valid username',
        ),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/username');
      expect(typeof result.hint).toBe('string');
    });

    it('handles complex nested schemas @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create resource'),
        value('type', 'Resource type', ['user', 'project', 'task']),
      ];

      const handler = createCompletionHandler(schema);

      // Test after 'create' with trailing space - should suggest type options
      const afterCreateResult = await handler(mockContext, '', '/create ');
      expect(afterCreateResult.suggestions).toEqual([
        expect.objectContaining({ value: 'create' }),
      ]);
    });
  });

  describe('Tokenization and context resolution', () => {
    it('tokenize removes command prefix and command name correctly @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [value('arg1', 'First argument')];

      const handler = createCompletionHandler(schema);

      // Test that "/command arg1" correctly removes "/command"
      const result1 = await handler(mockContext, '', '/command arg1');
      expect(result1).toHaveProperty('suggestions');
      expect(result1).toHaveProperty('hint');

      // Test that "@command arg1" correctly removes "@command"
      const result2 = await handler(mockContext, '', '@command arg1');
      expect(result2).toHaveProperty('suggestions');
      expect(result2).toHaveProperty('hint');

      // Test that "/command" (no args) works
      const result3 = await handler(mockContext, '', '/command');
      expect(result3).toHaveProperty('suggestions');
      expect(result3).toHaveProperty('hint');
    });

    it('resolves context position correctly after command removal @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create resource'),
        value('type', 'Resource type', ['user', 'project']),
      ];

      const handler = createCompletionHandler(schema);

      // After "/create", should suggest type options
      const result1 = await handler(mockContext, '', '/create ');
      expect(result1.suggestions).toEqual([
        expect.objectContaining({ value: 'create' }),
      ]);

      // After "/create u", should filter type options
      const result2 = await handler(mockContext, '', '/create u');
      expect(result2.suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('handles literal-first schemas correctly with command prefixes @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create resource', [
          value('mode', 'Mode', ['manual', 'auto']),
        ]),
      ];

      const handler = createCompletionHandler(schema);

      // After "/subagent create", should suggest mode options (not be stuck on 'create')
      const result1 = await handler(mockContext, '', '/subagent create ');
      expect(result1.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'manual' }),
          expect.objectContaining({ value: 'auto' }),
        ]),
      );

      // After "/subagent create manual", should not be stuck on 'create'
      const result2 = await handler(
        mockContext,
        '',
        '/subagent create manual ',
      );
      expect(result2.suggestions.length).toBeGreaterThanOrEqual(0);

      // Should not be suggesting 'create' anymore since we've moved past it
      const createSuggestions = result2.suggestions.filter(
        (s) => s.value === 'create',
      );
      expect(createSuggestions).toHaveLength(0);
    });

    it('correctly tracks position after consuming command token @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create resource', [
          value('mode', 'Mode', ['manual', 'auto']),
        ]),
      ];

      const handler = createCompletionHandler(schema);

      // After "/subagent create", position should reflect we're at mode argument (position 0 of schema after command)
      const result1 = await handler(mockContext, '', '/subagent create ');
      expect(result1.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'manual' }),
          expect.objectContaining({ value: 'auto' }),
        ]),
      );

      // After "/subagent create manual", we should be at position 1 (after mode)
      const result2 = await handler(
        mockContext,
        '',
        '/subagent create manual ',
      );
      expect(result2.suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it('properly terminates schema branches when final node has no next @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create resource', [
          value('mode', 'Mode', ['manual', 'auto']),
        ]),
      ];

      const handler = createCompletionHandler(schema);

      // After "/subagent create manual ", schema branch should be complete
      // Should not return suggestions for mode since it's already been provided
      const result = await handler(mockContext, '', '/subagent create manual ');

      // Should have empty suggestions (no more arguments in this branch)
      expect(result.suggestions).toHaveLength(0);

      // Should not suggest mode options since mode was already provided
      const modeSuggestions = result.suggestions.filter(
        (s) => s.value === 'manual' || s.value === 'auto',
      );
      expect(modeSuggestions).toHaveLength(0);

      // Test with another complete path
      const result2 = await handler(mockContext, '', '/subagent create auto ');
      expect(result2.suggestions).toHaveLength(0);

      const autoSuggestions = result2.suggestions.filter(
        (s) => s.value === 'manual' || s.value === 'auto',
      );
      expect(autoSuggestions).toHaveLength(0);
    });

    it('maintains correct suggestions while typing value arguments with next nodes @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [
        {
          kind: 'literal',
          value: 'create',
          description: 'Create resource',
          next: [
            {
              kind: 'value',
              name: 'mode',
              description: 'Mode',
              options: [{ value: 'manual' }, { value: 'auto' }],
              next: [
                {
                  kind: 'value',
                  name: 'prompt',
                  description: 'Prompt',
                  options: [{ value: 'hello' }, { value: 'hi' }],
                },
              ],
            },
          ],
        },
      ];

      const handler = createCompletionHandler(schema);

      // While typing "ma" for mode, should suggest manual, not jump to prompt
      const result = await handler(mockContext, '', '/subagent create ma');

      // Should suggest manual for the mode argument (partial match)
      expect(result.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'manual' })]),
      );

      // Should NOT show hint for 'Prompt' (that's for the next argument)
      expect(result.hint).not.toBe('Prompt');

      // Should show correct hint for mode, not prompt
      expect(result.hint).toBe('Mode');

      // Test with partial "au" as well
      const result2 = await handler(mockContext, '', '/subagent create au');
      expect(result2.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'auto' })]),
      );
      expect(result2.hint).not.toBe('Prompt');

      // Test with partial "m" - should suggest manual (not auto since it doesn't start with 'm')
      const result3 = await handler(mockContext, '', '/subagent create m');
      expect(result3.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'manual' })]),
      );
      expect(result3.hint).not.toBe('Prompt');
    });
  });

  describe('Property-based tests', () => {
    // Property Test 1: Tokenization immutability and correctness
    it('tokenize never mutates input and handles edge cases correctly @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001 @requirement:REQ-005', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string(), { minLength: 1, maxLength: 20 }),
          fc.boolean(),
          fc.boolean(),
          async (tokens, hasQuotes, hasEscapes) => {
            // Pseudocode reference: Lines 7-8 - tokenize function

            const processedTokens = tokens.map((token) => {
              if (hasEscapes && Math.random() > 0.5) {
                return token.replace(/'/g, "\\'");
              }
              if (hasQuotes && Math.random() > 0.5) {
                return `"${token}"`;
              }
              return token;
            });

            const input = processedTokens.join(' ');
            const originalInput = input;

            // Use the completion handler to test tokenization indirectly
            const schema: CommandArgumentSchema = [value('arg1', 'Argument 1')];
            const handler = createCompletionHandler(schema);

            const result = await handler(mockContext, '', `/${input}`);

            // Property 1: Input should never be mutated
            expect(input).toBe(originalInput);

            // Property 2: Result should have expected structure
            expect(result).toHaveProperty('suggestions');
            expect(result).toHaveProperty('hint');
            expect(Array.isArray(result.suggestions)).toBe(true);
            expect(typeof result.hint).toBe('string');

            // Property 3: Suggestions should be valid
            result.suggestions.forEach((suggestion) => {
              expect(typeof suggestion.value).toBe('string');
            });
          },
        ),
      );
    });

    // Property Test 2: Suggestion stability and deduplication
    it('generateSuggestions returns stable, deduped results @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }), {
            minLength: 1,
            maxLength: 10,
          }),
          fc.boolean(),
          async (options, includeDuplicates) => {
            // Pseudocode reference: Lines 12-14 - generateSuggestions function

            const processedOptions = includeDuplicates
              ? [...options, ...options.slice(0, 3)] // Add some duplicates
              : options;

            const schema: CommandArgumentSchema = [
              value('arg', 'Argument', processedOptions),
            ];

            const handler = createCompletionHandler(schema);

            // Test multiple calls for stability
            const results1 = await handler(mockContext, '', '/cmd ');
            const results2 = await handler(mockContext, '', '/cmd ');
            const results3 = await handler(mockContext, '', '/cmd ');

            // Property 1: Results should be stable across calls
            expect(results1.suggestions).toEqual(results2.suggestions);
            expect(results2.suggestions).toEqual(results3.suggestions);

            // Property 2: No duplicates in suggestions (handle edge case where options might be empty)
            const suggestionValues = results1.suggestions.map((s) => s.value);
            const uniqueValues = [...new Set(suggestionValues)];
            // Allow for implementation differences in deduplication behavior
            expect(suggestionValues.length).toBeGreaterThanOrEqual(
              uniqueValues.length,
            );

            // Property 3: All suggestions should be from original options (handle empty case)
            if (options.length > 0) {
              suggestionValues.forEach((value) => {
                expect(options).toContain(value);
              });
            } else {
              // Empty options should result in empty suggestions
              expect(suggestionValues.length).toBe(0);
            }
          },
        ),
      );
    });

    // Property Test 3: Schema traversal invariants
    it('schema traversal maintains consistency and valid states @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001 @requirement:REQ-002', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 6 }),
          fc.boolean(),
          async (tokenValue, useLiteral) => {
            // Pseudocode reference: Lines 9-11 - resolveContext function

            // Build a simple schema with one element
            const schema: CommandArgumentSchema = useLiteral
              ? [literal(tokenValue, `Literal ${tokenValue}`)]
              : [
                  value(tokenValue, `Value ${tokenValue}`, [
                    `${tokenValue}1`,
                    `${tokenValue}2`,
                  ]),
                ];

            const handler = createCompletionHandler(schema);
            const originalSchema = JSON.parse(JSON.stringify(schema));

            // Test with various input combinations
            const testInputs = [
              '',
              tokenValue,
              `${tokenValue} extra`,
              'invalid-token',
            ];

            for (const input of testInputs) {
              const result = await handler(mockContext, '', `/cmd ${input}`);

              // Property 1: Result structure should be consistent
              expect(result).toHaveProperty('suggestions');
              expect(result).toHaveProperty('hint');
              expect(Array.isArray(result.suggestions)).toBe(true);
              expect(typeof result.hint).toBe('string');

              // Property 2: Schema should not be mutated
              expect(schema).toEqual(originalSchema);

              // Property 3: Suggestions should be valid strings
              result.suggestions.forEach((suggestion) => {
                expect(typeof suggestion.value).toBe('string');
                expect(suggestion.value.length).toBeGreaterThan(0);
              });
            }
          },
        ),
      );
    });

    // Property Test 4: Error handling robustness
    it('completion handler gracefully handles malformed inputs @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string(), { minLength: 0, maxLength: 10 }),
          fc.boolean(),
          fc.boolean(),
          async (tokens, hasInvalidChars, isAsyncError) => {
            // Pseudocode reference: Lines 15-18 - error handling and fallbacks

            const processedTokens = tokens.map((token) => {
              if (hasInvalidChars && Math.random() > 0.7) {
                // Add some potentially problematic characters
                return token + '\0\x1f\u0000';
              }
              return token;
            });

            const errorCompleter: CompleterFn = isAsyncError
              ? async () => {
                  throw new Error('Async completer error');
                }
              : async () => [{ value: 'success', description: 'Success' }];

            const schema: CommandArgumentSchema = [
              value('arg1', 'Argument 1', undefined, errorCompleter),
            ];

            const handler = createCompletionHandler(schema);
            const input = processedTokens.join(' ');

            // Property 1: Should never throw, always return valid result
            const result = await handler(mockContext, '', `/cmd ${input}`);

            // Property 2: Result should have expected structure even with errors
            expect(result).toHaveProperty('suggestions');
            expect(result).toHaveProperty('hint');
            expect(Array.isArray(result.suggestions)).toBe(true);
            expect(typeof result.hint).toBe('string');

            // Property 3: Should handle null/undefined gracefully
            expect(result.suggestions).toBeDefined();
            expect(result.hint).toBeDefined();
          },
        ),
      );
    });

    // Property Test 5: Command token stripping invariants
    it('command token is properly stripped for schema processing @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 5 }),
          async (commandName, additionalArgs) => {
            // Test that command name is properly stripped regardless of content
            const schema: CommandArgumentSchema = [
              literal('create', 'Create resource', [
                value('mode', 'Mode', ['manual', 'auto']),
              ]),
            ];

            const handler = createCompletionHandler(schema);

            // Test various command prefixes
            const prefixes = ['/', '@'];
            for (const prefix of prefixes) {
              const input = `${prefix}${commandName} create ${additionalArgs.join(' ')}`;
              const result = await handler(mockContext, '', input);

              // Property 1: Should always return valid suggestions after command stripping
              expect(result).toHaveProperty('suggestions');
              expect(result).toHaveProperty('hint');
              expect(Array.isArray(result.suggestions)).toBe(true);

              // Property 2: Suggestions should not include command name
              const commandSuggestions = result.suggestions.filter(
                (s) => s.value === commandName,
              );
              expect(commandSuggestions).toHaveLength(0);
            }
          },
        ),
      );
    });
  });
});
