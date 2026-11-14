/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  durableRowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { checkpointRows } from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';

describe('fallback value serialization and media', () => {
  it('captures valid pending cyclic tool parameters without mutating the submitted graph', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const parameters: { name: string; self?: object } = { name: 'loop' };
      parameters.self = parameters;
      const row: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'cycle', name: 'inspect', parameters },
        ],
      };
      history.add(row);
      const operation = history.detachedValues.withCheckpoint(
        async (checkpoint) => {
          const snapshot = checkpoint;
          const expected: IContent['blocks'] = [
            {
              type: 'tool_call',
              id: 'cycle',
              name: 'inspect',
              parameters: { name: 'loop', self: { _circular: true } },
            },
          ];
          const rows = await Array.fromAsync(checkpointRows(snapshot));
          expect(rows[0].blocks).toStrictEqual(expected);
          await history.detachedValues.replace(snapshot);
          expect((await durableRowsOf(recorder))[0].blocks).toStrictEqual(
            expected,
          );
        },
      );
      releaseWriter();
      await operation;
      expect(parameters.self).toBe(parameters);
      expect(history.getTotalTokens()).toBe(1);
    }, true);
  }, 180_000);
});
