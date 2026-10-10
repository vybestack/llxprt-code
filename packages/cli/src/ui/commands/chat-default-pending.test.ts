/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  batchRow,
  withBatchFixture,
} from '@vybestack/llxprt-code-core/services/history/addbatch-stream-test-helpers.js';
import { publicChat } from '../../__tests__/public-history-cursor.js';

for (const size of [512, 8192]) {
  describe(`chat pending reader ${size}`, () => {
    it('reads every added row as an equal value in chronology order and releases cursor pins', async () => {
      await withBatchFixture(async ({ history, owners }) => {
        const chat = publicChat(history);
        const input = Array.from({ length: size }, (_, index) =>
          batchRow(index),
        );
        owners.registerInput(input);
        for (const row of input) history.add(row);
        await history.waitForCommit();
        let index = 0;
        let previousSeq = -1;
        for await (const row of chat.getHistory(false)) {
          const chronology = row.metadata?.chronology;
          if (chronology === undefined)
            throw new Error(`Row ${index} lost its chronology marker`);
          expect(chronology.seq).toBeGreaterThan(previousSeq);
          previousSeq = chronology.seq;
          expect(row.speaker).toBe(input[index].speaker);
          expect(row.blocks).toStrictEqual(input[index].blocks);
          index++;
        }
        expect(index).toBe(size);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 180_000);
  });
}
