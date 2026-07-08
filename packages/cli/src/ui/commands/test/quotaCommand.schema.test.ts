/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createCompletionHandler } from '../schema/index.js';
import { quotaCommand } from '../quotaCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';

const mockContext = createMockCommandContext();

describe('quotaCommand schema completion', () => {
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

  it('subcommands include status, credits, and reset', () => {
    const names = quotaCommand.subCommands?.map((sc) => sc.name);
    expect(names).toStrictEqual(
      expect.arrayContaining(['status', 'credits', 'reset']),
    );
  });
});
