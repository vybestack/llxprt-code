/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { createCompletionHandler } from '../schema/index.js';
import type { CommandContext } from '../types.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type { Config } from '@vybestack/llxprt-code-core';

const mockRuntime = {
  getEphemeralSettings: vi.fn(() => ({
    'context-limit': 100_000,
    'compression-threshold': 0.7,
    streaming: 'enabled',
    'socket-timeout': 60_000,
  })),
  getActiveModelParams: vi.fn(
    (): Record<string, unknown> => ({
      temperature: 0.7,
      max_tokens: 1000,
    }),
  ),
  setEphemeralSetting: vi.fn(),
  setActiveModelParam: vi.fn(),
  clearActiveModelParam: vi.fn(),
};

vi.mock('../../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));
import { setCommand } from '../setCommand.js';

/**
 * @plan:PLAN-20251013-AUTOCOMPLETE.P09
 * @requirement:REQ-006
 * @pseudocode ArgumentSchema.md lines 111-130
 * - Line 25: Arg0 literal: `unset`, `modelparam`, `emojifilter`, etc.
 * - Line 26: Each literal provides `next` definitions for subsequent value arguments.
 *
 * @plan:PLAN-20251013-AUTOCOMPLETE.P09a
 * Verification (2025-10-16):
 * - Command: `cd packages/cli && npx vitest run src/ui/commands/test/setCommand.phase09.test.ts`
 * - Result: 13 passed (GREEN – schema implementation under test)
 * - Property ratio: 4 / 13 ≈ 30.77%
 */

const commandSchema = setCommand.schema;

if (!commandSchema) {
  throw new Error('setCommand schema is not configured');
}

describe('setCommand schema integration', () => {
  // Mock context for testing
  const mockContext: CommandContext = createMockCommandContext({
    services: {
      config: {
        getEphemeralSettings: () => ({
          'context-limit': 100_000,
          'compression-threshold': 0.7,
          streaming: 'enabled',
          'socket-timeout': 60_000,
        }),
        getProviderManager: () => ({
          getActiveProvider: () => ({
            name: 'test-provider',
            getModelParams: () => ({
              temperature: 0.7,
              max_tokens: 1000,
            }),
          }),
        }),
      } as unknown as Config,
    },
  });

  let handler: ReturnType<typeof createCompletionHandler>;

  beforeEach(() => {
    mockRuntime.getEphemeralSettings.mockReturnValue({
      'context-limit': 100_000,
      'compression-threshold': 0.7,
      streaming: 'enabled',
      'socket-timeout': 60_000,
    });
    mockRuntime.getActiveModelParams.mockReturnValue({
      temperature: 0.7,
      max_tokens: 1000,
    });
    handler = createCompletionHandler(commandSchema);
  });

  describe('literal subcommand selection', () => {
    it('should suggest available subcommands when no input provided @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(mockContext, '', '/set ');

      expect(result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'unset' }),
          expect.objectContaining({ value: 'modelparam' }),
          expect.objectContaining({ value: 'emojifilter' }),
          expect.objectContaining({ value: 'context-limit' }),
          expect.objectContaining({ value: 'compression-threshold' }),
        ]),
      );
      expect(result.hint).toBe('Select option');
      expect(result.position).toBe(1);
    });

    it('should filter literal subcommands based on partial input @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(mockContext, 'mo', '/set mo');

      // With deep path completion, we now also get nested paths like 'modelparam temperature'
      // The single-level 'modelparam' should still be included and appear first
      expect(result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'modelparam' }),
        ]),
      );

      // Verify modelparam appears first (before any deep paths)
      const modelparamIndex = result.suggestions.findIndex(
        (s) => s.value === 'modelparam',
      );
      expect(modelparamIndex).toBeGreaterThanOrEqual(0);

      // Any deep paths should come after the single-level match
      const deepPathIndex = result.suggestions.findIndex((s) =>
        s.value.includes(' '),
      );
      // If deep paths exist, they must come after single-level matches
      // deepPathIndex === -1 means no deep paths, which is also valid
      expect(deepPathIndex === -1 || modelparamIndex < deepPathIndex).toBe(
        true,
      );

      expect(result.hint).toBe('Select option');
    });

    it('should accept exact literal match and advance to next arguments @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(mockContext, '', '/set unset ');

      expect(result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'context-limit' }),
          expect.objectContaining({ value: 'emojifilter' }),
          expect.objectContaining({ value: 'modelparam' }),
        ]),
      );
      expect(result.hint).toBe('setting key to remove');
      expect(result.position).toBe(1);
    });
  });

  describe('nested value arguments', () => {
    it('should provide emojifilter mode options after selecting emojifilter @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(mockContext, '', '/set emojifilter ');

      expect(result.suggestions).toEqual([
        expect.objectContaining({ value: 'allowed' }),
        expect.objectContaining({ value: 'auto' }),
        expect.objectContaining({ value: 'warn' }),
        expect.objectContaining({ value: 'error' }),
      ]);
      expect(result.hint).toBe('filter mode');
      expect(result.position).toBe(1);
    });

    it('should handle modelparam parameter completion via async completer @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      mockRuntime.getActiveModelParams.mockReturnValue({
        temperature: 0.7,
        max_tokens: 1000,
      });
      const result = await handler(mockContext, '', '/set modelparam ');

      expect(result.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: 'temperature',
            description: 'Parameter: temperature',
          }),
          expect.objectContaining({
            value: 'max_tokens',
            description: 'Parameter: max_tokens',
          }),
        ]),
      );
      expect(result.hint).toBe('parameter name');
      expect(result.position).toBe(1);
    });

    it('should advance to value argument after setting modelparam name @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(
        mockContext,
        '',
        '/set modelparam temperature ',
      );

      expect(result.suggestions).toEqual([]); // No predefined options for values
      expect(result.hint).toBe(
        'value to set for the parameter (number, string, boolean, or JSON)',
      );
      expect(result.position).toBe(2);
    });
  });

  describe('literal completion termination', () => {
    it('should stop suggesting new keys after completing a literal value @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(
        mockContext,
        '',
        '/set context-limit 50000 ',
      );

      expect(result.suggestions).toEqual([]);
      expect(result.hint).toBe('');
    });

    it('should not reopen selection after socket-keepalive value @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(
        mockContext,
        '',
        '/set socket-keepalive true ',
      );

      expect(result.suggestions).toEqual([]);
      expect(result.hint).toBe('');
    });
  });

  describe('hint text correctness', () => {
    it('should show appropriate hints for context-limit setting @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(mockContext, '', '/set context-limit ');

      expect(result.hint).toBe('positive integer (e.g., 100000)');
      expect(result.position).toBe(1);
    });

    it('should show appropriate hints for compression-threshold setting @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(
        mockContext,
        '',
        '/set compression-threshold ',
      );

      expect(result.hint).toBe('decimal between 0 and 1 (e.g., 0.7)');
      expect(result.position).toBe(1);
    });

    it('should show context-sensitive hints for unset subkey @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const result = await handler(mockContext, '', '/set unset modelparam ');

      expect(result.hint).toBe(
        'model parameter name (e.g., temperature, max_tokens)',
      );
      expect(result.position).toBe(2);
    });
  });

  describe('property-based expectations', () => {
    it('property: exposes provider parameter suggestions for any parameter set @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
            minLength: 1,
            maxLength: 5,
          }),
          async (paramNames) => {
            const dynamicParams = Object.fromEntries(
              paramNames.map((name) => [name, 'value']),
            );
            mockRuntime.getActiveModelParams.mockReturnValue(dynamicParams);

            const result = await handler(mockContext, '', '/set modelparam ');

            expect(result.suggestions.map((s) => s.value)).toEqual(
              expect.arrayContaining(paramNames),
            );
            expect(result.hint).toBe('parameter name');
            expect(result.position).toBe(1);

            mockRuntime.getActiveModelParams.mockReturnValue({
              temperature: 0.7,
              max_tokens: 1000,
            });
          },
        ),
      );
    });

    it('property: maintains structured hints across arbitrary literal prefixes @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string(), async (rawInput) => {
          const prefix = rawInput.trim();
          const commandLine = prefix ? `/set ${prefix}` : '/set ';
          const result = await handler(mockContext, prefix, commandLine);

          expect(result).toHaveProperty('suggestions');
          expect(result).toHaveProperty('hint');
          expect(result).toHaveProperty('position');
          expect(result.hint).not.toBe('');
        }),
      );
    });

    it('property: emits contextual value hints for selected settings @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      const expectedHints: Record<string, string> = {
        'context-limit': 'positive integer (e.g., 100000)',
        'compression-threshold': 'decimal between 0 and 1 (e.g., 0.7)',
        'socket-timeout': 'positive integer in milliseconds (e.g., 60000)',
      };

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...Object.keys(expectedHints)),
          async (settingKey) => {
            const result = await handler(
              mockContext,
              '',
              `/set ${settingKey} `,
            );

            expect(result.hint).toBe(expectedHints[settingKey]);
            expect(result.position).toBe(1);
          },
        ),
      );
    });

    it('property: nested unset subkeys surface contextual hints @plan:PLAN-20251013-AUTOCOMPLETE.P09 @requirement:REQ-006', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('modelparam', 'custom-headers'),
          async (subkey) => {
            const result = await handler(
              mockContext,
              '',
              `/set unset ${subkey} `,
            );

            const expectedHint =
              subkey === 'modelparam'
                ? 'model parameter name (e.g., temperature, max_tokens)'
                : 'header name (e.g., Authorization)';

            expect(result.hint).toBe(expectedHint);
            expect(result.position).toBe(2);
          },
        ),
      );
    });
  });
});
