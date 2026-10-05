/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import { withDetachedFixture } from './detached-rollback-test-helpers.js';
import {
  durableRowsOf,
  rowsOf,
  exactTokenizer,
} from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';

describe('addBatch tool payload serialization', () => {
  it('preserves valid cyclic tool parameters through the established serialization boundary without mutating callers', async () => {
    await withDetachedFixture(async ({ recorder }) => {
      const history = new HistoryService({ recording: recorder });
      history.setTokenizerFactory(exactTokenizer());
      try {
        const parameters: { name: string; self?: object } = { name: 'loop' };
        parameters.self = parameters;
        const caller: IContent = {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'cycle', name: 'inspect', parameters },
          ],
        };
        await history.addBatch([caller]);
        await history.waitForCommit();
        expect(parameters.self).toBe(parameters);
        expect(caller.metadata).toBeUndefined();
        const stored = await rowsOf(history);
        expect(stored[0].blocks).toStrictEqual([
          {
            type: 'tool_call',
            id: 'cycle',
            name: 'inspect',
            parameters: { name: 'loop', self: { _circular: true } },
          },
        ]);
        expect((await durableRowsOf(recorder))[0].blocks).toStrictEqual(
          stored[0].blocks,
        );
        expect(stored[0].metadata?.chronology?.seq).toBe(1);
      } finally {
        history.dispose();
      }
    });
  });
});
