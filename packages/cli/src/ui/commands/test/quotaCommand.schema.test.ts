/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, it, expect } from 'bun:test';
import { createCompletionHandler } from '../schema/index.js';
import { createMockCommandContext } from '../../../__tests__/mockCommandContext.js';
import { registerQuotaCommand } from '../../../__tests__/credential-command-test-owner.js';
import type { SlashCommand } from '../types.js';
import type {
  CommandArgumentSchema,
  CompletionResult,
} from '../schema/types.js';

describe('quotaCommand schema completion', () => {
  let mockContext: ReturnType<typeof createMockCommandContext>;
  let quotaCommand: SlashCommand;
  beforeEach(() => {
    mockContext = createMockCommandContext();
    quotaCommand = registerQuotaCommand(mockContext);
  });

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
   * Invoke the reset completion handler and return the full result object.
   */
  async function getResetResult(partialArg: string): Promise<CompletionResult> {
    const handler = createCompletionHandler(getResetSchema());
    return handler(
      mockContext,
      {
        args: '',
        completedArgs: [],
        partialArg,
        commandPathLength: 2,
      },
      `/quota reset ${partialArg}`,
    );
  }

  /**
   * Invoke the reset completion handler and return only the suggestion values.
   */
  async function getResetSuggestions(
    partialArg: string,
  ): Promise<readonly string[]> {
    return (await getResetResult(partialArg)).suggestions.map((s) => s.value);
  }

  it('offers codex as the provider for /quota reset', async () => {
    const values = await getResetSuggestions('');
    expect(values).toContain('codex');
  });

  it('partialArg "co" yields only codex', async () => {
    const values = await getResetSuggestions('co');
    expect(values).toStrictEqual(['codex']);
  });

  it('partialArg "CO" yields codex (case-insensitive fuzzy match)', async () => {
    const values = await getResetSuggestions('CO');
    expect(values).toStrictEqual(['codex']);
  });

  it('partialArg "xyz" yields no suggestions', async () => {
    const values = await getResetSuggestions('xyz');
    expect(values).toStrictEqual([]);
  });

  it('the codex suggestion has description Codex (ChatGPT)', async () => {
    const result = await getResetResult('');

    const codexSuggestion = result.suggestions.find((s) => s.value === 'codex');
    expect(codexSuggestion).toBeDefined();
    expect(codexSuggestion?.description).toBe('Codex (ChatGPT)');
  });
});
