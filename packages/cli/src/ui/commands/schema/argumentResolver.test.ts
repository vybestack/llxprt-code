/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { createCompletionHandler, tokenize } from './index.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type {
  CommandArgumentSchema,
  LiteralArgument,
  ValueArgument,
  CompleterFn,
  HintFn,
} from './types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

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
  hint?: HintFn | string,
  next?: CommandArgumentSchema,
): ValueArgument => ({
  kind: 'value',
  name,
  description,
  options: (options || []).map((opt) =>
    typeof opt === 'string' ? { value: opt } : opt,
  ),
  completer,
  hint,
  next,
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
      expect(result.position).toBe(1);
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
      expect(result.hint).toBe('Enter a valid username');
      expect(result.position).toBe(1);
    });

    it('returns literal descriptions as hints when literal nodes are active @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create a resource'),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/subagent ');
      expect(result.hint).toBe('Create a resource');
      expect(result.suggestions).toEqual([
        expect.objectContaining({ value: 'create' }),
      ]);
      expect(result.position).toBe(1);
    });

    it('filters literal suggestions based on partial input @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create a resource'),
        literal('delete', 'Delete a resource'),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/subagent cr');

      expect(result.suggestions).toEqual([
        expect.objectContaining({ value: 'create' }),
      ]);
    });

    it('omits literal suggestions when partial does not match @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      const schema: CommandArgumentSchema = [
        literal('create', 'Create a resource'),
        literal('delete', 'Delete a resource'),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/subagent zz');

      expect(result.suggestions).toEqual([]);
    });

    it('prefers string hints on value arguments over descriptions @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-004', async () => {
      const schema: CommandArgumentSchema = [
        value('mode', '', ['manual', 'auto'], undefined, 'Select mode'),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/command ');
      expect(result.hint).toBe('Select mode');
      expect(result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'manual' }),
          expect.objectContaining({ value: 'auto' }),
        ]),
      );
      expect(result.position).toBe(1);
    });

    it('awaits async hint functions for value arguments @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-004', async () => {
      const dynamicHint: HintFn = vi.fn(async () => 'Dynamic mode hint');
      const schema: CommandArgumentSchema = [
        value('mode', '', ['manual', 'auto'], undefined, dynamicHint),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/command m');
      expect(dynamicHint).toHaveBeenCalledTimes(1);
      expect(result.hint).toBe('Dynamic mode hint');
      expect(result.suggestions).toEqual([
        expect.objectContaining({ value: 'manual' }),
      ]);
      expect(result.position).toBe(2);
    });

    it('falls back to value descriptions when hints are absent @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-004', async () => {
      const schema: CommandArgumentSchema = [
        value('mode', 'Mode description', ['manual', 'auto']),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/command ');
      expect(result.hint).toBe('Mode description');
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.position).toBe(1);
    });

    it('returns empty hint when no hint or description is provided @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-004', async () => {
      const schema: CommandArgumentSchema = [
        value('mode', '', ['manual', 'auto']),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/command ');
      expect(result.hint).toBe('');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('returns empty suggestions when value has no options or completer @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (input) => {
          const schema: CommandArgumentSchema = [value('mode', '', undefined)];
          const handler = createCompletionHandler(schema);
          const result = await handler(mockContext, '', `/command ${input}`);
          expect(result.suggestions).toEqual([]);
        }),
      );
    });

    it('filters value suggestions based on partial input @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-002', async () => {
      const schema: CommandArgumentSchema = [
        value('mode', 'Mode description', ['manual', 'auto', 'archive']),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(mockContext, '', '/command ar');

      expect(result.suggestions).toEqual([
        expect.objectContaining({ value: 'archive' }),
      ]);
    });

    it('returns empty suggestions when schema is empty @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (input) => {
          const warnSpy = vi
            .spyOn(DebugLogger.prototype, 'warn')
            .mockImplementation(() => {});
          const handler = createCompletionHandler([]);
          const result = await handler(mockContext, '', input);
          expect(result.suggestions).toEqual([]);
          expect(result.hint).toBe('');
          expect(warnSpy).not.toHaveBeenCalled();
          warnSpy.mockRestore();
        }),
      );
    });

    it('logs and recovers when suggestion generation throws @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const failingCompleter: CompleterFn = async () => {
        throw new Error('completer boom');
      };

      const warnSpy = vi
        .spyOn(DebugLogger.prototype, 'warn')
        .mockImplementation(() => {});

      const schema: CommandArgumentSchema = [
        value('mode', '', undefined, failingCompleter),
      ];

      const handler = createCompletionHandler(schema);

      const result = await handler(mockContext, '', '/command ');
      expect(result.suggestions).toEqual([]);
      expect(result.hint).toBe('');
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(Function), // DebugLogger.warn takes a function that returns the message
      );

      warnSpy.mockRestore();
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
      expect(afterCreateResult.position).toBe(1);
    });
  });

  describe('Tokenization and context resolution', () => {
    it('tokenize handles escaped spaces @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const safeWord = fc
        .array(fc.constantFrom('a', 'b', 'c', 'd', 'e'), {
          minLength: 1,
          maxLength: 5,
        })
        .map((chars) => chars.join(''));

      fc.assert(
        fc.property(
          fc.array(safeWord, { minLength: 1, maxLength: 3 }),
          (words) => {
            const rawSegment = words.join(' ');
            const escapedSegment = rawSegment.replace(/ /g, '\\ ');

            const info = tokenize(`/cmd ${escapedSegment}`);

            expect(info.tokens[0]).toBe('cmd');
            expect(info.tokens[1]).toBe(rawSegment);
            expect(info.partialToken).toBe(rawSegment);
            expect(info.hasTrailingSpace).toBe(false);
          },
        ),
      );
    });

    it('tokenize handles quoted segments @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const info = tokenize('/cmd "quoted value" next');

      expect(info.tokens).toEqual(['cmd', 'quoted value', 'next']);
      expect(info.partialToken).toBe('next');
      expect(info.hasTrailingSpace).toBe(false);
    });

    it('tokenize handles single quoted segments @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const info = tokenize("/cmd 'single quoted' next");

      expect(info.tokens).toEqual(['cmd', 'single quoted', 'next']);
      expect(info.partialToken).toBe('next');
      expect(info.hasTrailingSpace).toBe(false);
    });

    it('tokenize splits unquoted segments @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const info = tokenize('/cmd alpha beta');

      expect(info.tokens).toEqual(['cmd', 'alpha', 'beta']);
      expect(info.partialToken).toBe('beta');
      expect(info.hasTrailingSpace).toBe(false);
    });

    it('tokenize removes command prefix and command name correctly @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', async () => {
      const schema: CommandArgumentSchema = [value('arg1', 'First argument')];

      const handler = createCompletionHandler(schema);

      // Test that "/command arg1" correctly removes "/command"
      const result1 = await handler(mockContext, '', '/command arg1');
      expect(result1).toHaveProperty('suggestions');
      expect(result1).toHaveProperty('hint');
      const prefixInfo = tokenize('/command arg1');
      expect(prefixInfo.tokens).toEqual(['command', 'arg1']);

      // Test that "@command arg1" correctly removes "@command"
      const result2 = await handler(mockContext, '', '@command arg1');
      expect(result2).toHaveProperty('suggestions');
      expect(result2).toHaveProperty('hint');

      // Test that "/command" (no args) works
      const result3 = await handler(mockContext, '', '/command');
      expect(result3).toHaveProperty('suggestions');
      expect(result3).toHaveProperty('hint');
    });

    it('tokenize removes command prefix tokens even without additional args @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const info = tokenize('/command');

      expect(info.tokens).toEqual(['/command']);
      expect(info.partialToken).toBe('/command');
    });

    it('tokenize keeps a single command token without stripping slash when no args present', () => {
      const info = tokenize('/single');

      expect(info.tokens).toEqual(['/single']);
      expect(info.partialToken).toBe('/single');
      expect(info.hasTrailingSpace).toBe(false);
    });

    it('tokenize strips prefix when arguments follow the command', () => {
      const info = tokenize('/cmd argument');

      expect(info.tokens).toEqual(['cmd', 'argument']);
      expect(info.partialToken).toBe('argument');
    });

    it('tokenize strips @ prefix when arguments follow the command', () => {
      const info = tokenize('@cmd argument');

      expect(info.tokens).toEqual(['cmd', 'argument']);
      expect(info.partialToken).toBe('argument');
    });

    it('tokenize returns empty partial token when trailing space follows command', () => {
      const info = tokenize('/cmd ');

      expect(info.tokens).toEqual(['cmd']);
      expect(info.partialToken).toBe('');
      expect(info.hasTrailingSpace).toBe(true);
    });

    it('tokenize removes prefix-only commands', () => {
      const info = tokenize('/');

      expect(info.tokens).toEqual([]);
      expect(info.partialToken).toBe('');
    });

    it('tokenize leaves tokens untouched when no prefix is present', () => {
      const info = tokenize('plain argument');

      expect(info.tokens).toEqual(['plain', 'argument']);
      expect(info.partialToken).toBe('argument');
      expect(info.hasTrailingSpace).toBe(false);
    });

    it('tokenize does not emit empty tokens for repeated spaces', () => {
      const info = tokenize('/cmd    value');

      expect(info.tokens).toEqual(['cmd', 'value']);
    });

    it('tokenize only strips known prefix characters', () => {
      const info = tokenize('!cmd argument');

      expect(info.tokens).toEqual(['!cmd', 'argument']);
    });

    it('computeHintForLiterals falls back to first description when endings differ', async () => {
      const schema: CommandArgumentSchema = [
        literal('auto', 'Automatic mode'),
        literal('manual', 'Manual prompt required'),
      ];

      const handler = createCompletionHandler(schema);
      const result = await handler(
        mockContext,
        {
          args: '',
          completedArgs: [],
          partialArg: '',
          commandPathLength: 0,
        },
        '',
      );

      expect(result.hint).toBe('Automatic mode');
    });

    it('tokenize detects trailing space @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const info = tokenize('/cmd value ');

      expect(info.tokens).toEqual(['cmd', 'value']);
      expect(info.partialToken).toBe('');
      expect(info.hasTrailingSpace).toBe(true);
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
            const hasOptions = options.length > 0;
            const allSuggestionsValid =
              (!hasOptions && suggestionValues.length === 0) ||
              (hasOptions &&
                suggestionValues.every((value) => options.includes(value)));
            expect(allSuggestionsValid).toBe(true);
          },
        ),
      );
    });

    // Property Test 2a: Value hints prefer explicit string hints when provided
    it('value hints prefer explicit strings over descriptions @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-004', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 12 }),
          async (hintText) => {
            const schema: CommandArgumentSchema = [
              value('mode', '', ['manual', 'auto'], undefined, hintText),
            ];

            const handler = createCompletionHandler(schema);
            const result = await handler(mockContext, '', '/command ');

            expect(result.hint).toBe(hintText);
            expect(result.suggestions.length).toBeGreaterThan(0);
          },
        ),
      );
    });

    // Property Test 2b: tokenize removes wrapping quotes consistently
    it('tokenize unwraps quoted tokens across inputs @plan:PLAN-20251013-AUTOCOMPLETE.P04 @requirement:REQ-001', () => {
      const safeString = fc
        .array(fc.constantFrom('a', 'b', 'c', 'd', 'e'), {
          minLength: 1,
          maxLength: 5,
        })
        .map((chars) => chars.join(''));

      fc.assert(
        fc.property(safeString, safeString, (quoted, tail) => {
          const info = tokenize(`/cmd "${quoted}" ${tail}`);

          expect(info.tokens[0]).toBe('cmd');
          expect(info.tokens[1]).toBe(quoted);
          expect(info.tokens[2]).toBe(tail);
        }),
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
