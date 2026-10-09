/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { enrichSchemaDepthError } from './schemaDepthErrorEnrichment.js';

describe('schema depth error diagnostics', () => {
  it('counts flat declarations and identifies cyclic parameter schemas', () => {
    const cyclicSchema: Record<string, unknown> = { $ref: '#/' };
    const logger = new DebugLogger('issue3694:error-test');
    const entries: unknown[] = [];
    const output = vi
      .spyOn(logger, 'error')
      .mockImplementation((_message, ...args) => {
        entries.push(...args);
      });
    try {
      enrichSchemaDepthError(
        { message: 'maximum schema depth exceeded' },
        [
          {
            name: 'safe',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
          { name: 'cyclic', parametersJsonSchema: cyclicSchema },
          { name: 'denied', parametersJsonSchema: false },
        ],
        logger,
      );
      expect(entries).toStrictEqual([
        {
          totalTools: 3,
          toolNames: ['safe', 'cyclic', 'denied'],
          cyclicSchemaTools: ['cyclic'],
        },
      ]);
    } finally {
      output.mockRestore();
    }
  });
});
