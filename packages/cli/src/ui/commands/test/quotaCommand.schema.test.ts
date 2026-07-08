/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createCompletionHandler } from '../schema/index.js';
import { quotaCommand } from '../quotaCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type { CommandArgumentSchema } from '../schema/types.js';

describe('quotaCommand schema completion', () => {
  // The completion handler is read-only with respect to the context for these
  // tests (it never mutates it), so a single shared mock is safe and avoids
  // per-test boilerplate.
  const mockContext = createMockCommandContext();

  /**
   * Resolve the reset subcommand, asserting its schema exists at runtime and
   * narrowing it to a non-optional CommandArgumentSchema for the caller.
   * Uses explicit null/undefined checks so TypeScript narrows without an
   * assertion expression.
   */
  function getResetSchema(): CommandArgumentSchema {
    const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
    if (reset === undefined) {
      throw new Error('reset subcommand not found');
    }
    const schema = reset.schema;
    if (schema === undefined) {
      throw new Error('reset subcommand has no schema');
    }
    return schema;
  }

  /**
   * Invoke the reset completion handler and return only the suggestion values.
   */
  async function getResetSuggestions(
    partialArg: string,
  ): Promise<readonly string[]> {
    const handler = createCompletionHandler(getResetSchema());
    const result = await handler(
      mockContext,
      {
        args: '',
        completedArgs: [],
        partialArg,
        commandPathLength: 2,
      },
      `/quota reset ${partialArg}`,
    );
    return result.suggestions.map((s) => s.value);
  }

  it('only the reset subcommand has a schema', () => {
    const subCommands = quotaCommand.subCommands ?? [];
    const resetSchema = subCommands.find((sc) => sc.name === 'reset')?.schema;
    const nonResetSchemas = subCommands
      .filter((sc) => sc.name !== 'reset')
      .map((sc) => sc.schema);
    expect(resetSchema).toBeDefined();
    expect(nonResetSchemas.every((s) => s === undefined)).toBe(true);
  });

  it('offers codex as the provider for /quota reset', async () => {
    const values = await getResetSuggestions('');
    expect(values).toContain('codex');
  });

  it('partialArg "co" still yields exactly codex', async () => {
    const values = await getResetSuggestions('co');
    expect(values).toStrictEqual(['codex']);
  });

  it('partialArg "xyz" yields no suggestions', async () => {
    const schema = getResetSchema();
    const handler = createCompletionHandler(schema);
    const result = await handler(
      mockContext,
      {
        args: '',
        completedArgs: [],
        partialArg: 'xyz',
        commandPathLength: 2,
      },
      '/quota reset xyz',
    );

    expect(result.suggestions).toStrictEqual([]);
  });

  it('the codex suggestion has description Codex (ChatGPT)', async () => {
    const schema = getResetSchema();
    const handler = createCompletionHandler(schema);
    const result = await handler(
      mockContext,
      {
        args: '',
        completedArgs: [],
        partialArg: '',
        commandPathLength: 2,
      },
      '/quota reset ',
    );

    const codexSuggestion = result.suggestions.find((s) => s.value === 'codex');
    expect(codexSuggestion).toBeDefined();
    expect(codexSuggestion?.description).toBe('Codex (ChatGPT)');
  });
});
