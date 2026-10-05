/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import { foldDurableRows } from '@vybestack/llxprt-code-core/recording/durableRowFold.js';
import { chatCommand } from './chatCommand.js';
import { withChatMutationFixture } from './chat-mutation-test-fixture.js';

for (const size of [512, 8192]) {
  for (const name of ['clear', 'restore']) {
    describe(`${name} live chat stream ${size}`, () => {
      it('persists the human-turn cut before publishing the byte-identical disk prefix', async () => {
        await withChatMutationFixture(
          size,
          async ({ context, client, recording, reader }) => {
            let displayed = 0;
            context.ui.addItem = () => ++displayed;
            const result = await chatCommand.subCommands
              ?.find((command) => command.name === name)
              ?.action?.(context, name === 'restore' ? '1' : '');
            expect(result).toBeUndefined();
            const expectedCount =
              name === 'clear' ? 3 : size - 1 - ((size - 1) % 3);
            const actual = createHash('sha256');
            const expected = createHash('sha256');
            let count = 0;
            for await (const row of client.getChat().getHistory()) {
              actual.update(JSON.stringify(row.blocks));
              expected.update(JSON.stringify(accountingRow(count++).blocks));
            }
            expect({ count, digest: actual.digest('hex') }).toStrictEqual({
              count: expectedCount,
              digest: expected.digest('hex'),
            });
            expect(displayed).toBe(name === 'restore' ? expectedCount : 0);
            expect(reader.snapshot().liveRows).toBe(0);
            expect(reader.snapshot().peakRows).toBeLessThanOrEqual(440);
            const path = recording.getFilePath();
            if (path === null) throw new Error('Missing recording path');
            const fold = await foldDurableRows({
              filePath: path,
              maxBytes: (await stat(path)).size,
            });
            try {
              expect(fold.length).toBe(expectedCount);
            } finally {
              await fold.close();
            }
          },
        );
      }, 180_000);
    });
  }
}
