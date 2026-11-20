/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRollbackFixture,
  durableRowsOf,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';

describe('fallback value serialization and media', () => {
  it('preserves valid cyclic candidate tool parameters through the existing serialization boundary', async () => {
    await withRollbackFixture(async (history, recorder) => {
      const parameters: { name: string; self?: object } = { name: 'loop' };
      parameters.self = parameters;
      const row: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'cycle', name: 'inspect', parameters },
        ],
      };
      const rows = {
        length: 1,
        readRow: (): IContent => row,
        *[Symbol.iterator](): Generator<IContent, void, unknown> {
          yield row;
        },
      };
      await publishProviderFallbackCandidate(
        history,
        { rows, start: 0, hasPendingRows: true },
        'test',
      );
      expect((await durableRowsOf(recorder))[0].blocks).toStrictEqual([
        {
          type: 'tool_call',
          id: 'cycle',
          name: 'inspect',
          parameters: { name: 'loop', self: { _circular: true } },
        },
      ]);
      expect(parameters.self).toBe(parameters);
      expect(row.metadata).toBeUndefined();
      expect(history.getTotalTokens()).toBe(1);
    });
  }, 180_000);
});
