/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createCompletionHandler } from '../schema/index.js';
import { quotaCommand } from '../quotaCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';

describe('quotaCommand schema completion', () => {
  let mockContext: ReturnType<typeof createMockCommandContext>;

  beforeEach(() => {
    mockContext = createMockCommandContext();
  });

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
    const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
    expect(reset?.schema).toBeDefined();

    const handler = createCompletionHandler(reset!.schema!);
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

    const values = result.suggestions.map((s) => s.value);
    expect(values).toContain('codex');
  });

  it('partialArg "co" still yields exactly codex', async () => {
    const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
    const handler = createCompletionHandler(reset!.schema!);
    const result = await handler(
      mockContext,
      {
        args: '',
        completedArgs: [],
        partialArg: 'co',
        commandPathLength: 2,
      },
      '/quota reset co',
    );

    const values = result.suggestions.map((s) => s.value);
    expect(values).toStrictEqual(['codex']);
  });

  it('partialArg "xyz" yields no suggestions', async () => {
    const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
    const handler = createCompletionHandler(reset!.schema!);
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
    const reset = quotaCommand.subCommands?.find((sc) => sc.name === 'reset');
    const handler = createCompletionHandler(reset!.schema!);
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
