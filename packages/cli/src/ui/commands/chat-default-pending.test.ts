/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import {
  batchRow,
  withBatchFixture,
} from '@vybestack/llxprt-code-core/services/history/addbatch-stream-test-helpers.js';
import { publicChat } from '../../__tests__/public-history-cursor.js';

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

for (const size of [512, 8192]) {
  describe(`chat pending reader ${size}`, () => {
    it('preserves caller row identity while charging all unsettled owners and releases cursor pins', async () => {
      await withBatchFixture(
        async ({
          history,
          owners,
          pauseWriter,
          waitForPausedWrite,
          releaseWriter,
        }) => {
          const chat = publicChat(history);
          const input = Array.from({ length: size }, (_, index) =>
            batchRow(index),
          );
          owners.registerInput(input);
          pauseWriter();
          for (const row of input) history.add(row);
          await waitForPausedWrite;
          const markers = input.map((row) => row.metadata?.chronology);
          try {
            const output = process.env.CHAT_PENDING_OUTPUT;
            if (output !== undefined)
              appendFileSync(
                output,
                JSON.stringify({
                  size,
                  phase: 'pending',
                  ...owners.snapshot(),
                }) + '\n',
              );
            expect(owners.within(bounds)).toBe(
              process.env.CHAT_PENDING_TRAP === '1',
            );
            let index = 0;
            for await (const row of chat.getHistory(false)) {
              expect(row.metadata?.chronology).toBe(markers[index]);
              expect(row).toBe(input[index++]);
            }
            expect(index).toBe(size);
            releaseWriter();
            await history.waitForCommit();
            expect(owners.snapshot().liveRows).toBe(0);
          } finally {
            releaseWriter();
          }
        },
      );
    }, 180_000);
  });
}
