/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withRollbackFixture,
  rollbackRow,
  exactTokenizer,
} from './chronology-rollback-test-helpers.js';

describe('fallback candidate loss', () => {
  it('rejects a lost restore candidate without publishing a partial history', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.transformRows(async (_source, sink) => {
        sink.appendDetached(rollbackRow(0));
        sink.appendDetached(rollbackRow(1));
      });
      await recorder.flush();
      await history.withRawHistorySnapshot(async (snapshot) => {
        await history.replaceAll([rollbackRow(2)]);
        const before = readdirSync(tmpdir());
        let damaged = false;
        history.setTokenizerFactory(
          exactTokenizer(() => {
            if (damaged) return;
            const root = readdirSync(tmpdir()).find(
              (name) =>
                name.startsWith('history-density-') && !before.includes(name),
            );
            if (root === undefined) throw new Error('Missing active candidate');
            truncateSync(join(tmpdir(), root, 'index'), 0);
            damaged = true;
          }),
        );
        await expect(
          history.restoreRawHistorySnapshot(snapshot),
        ).rejects.toThrow(/progress/);
        const blocks: unknown[] = [];
        for await (const row of history.streamRawHistory())
          blocks.push(row.blocks);
        expect(blocks).toStrictEqual([rollbackRow(2).blocks]);
        expect(
          readdirSync(tmpdir()).filter(
            (name) =>
              name.startsWith('history-density-') && !before.includes(name),
          ),
        ).toStrictEqual([]);
      });
    });
  });
});
