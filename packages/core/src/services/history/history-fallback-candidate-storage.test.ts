/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import {
  withRollbackFixture,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';

describe('fallback restore candidate storage', () => {
  it.each(['rows', 'index'])(
    'closes partially opened candidate when %s cannot open',
    async (file) => {
      await withRollbackFixture(async (history, recorder) => {
        await history.transformRows(async (_source, sink) => {
          sink.appendDetached(rollbackRow(0));
        });
        await recorder.flush();
        await history.withRawHistorySnapshot(async (snapshot) => {
          await history.replaceAll([rollbackRow(1)]);
          const before = fs.readdirSync(tmpdir());
          const original = fs.openSync;
          const open = vi
            .spyOn(fs, 'openSync')
            .mockImplementation((path, flags, mode) => {
              if (
                String(path).includes('history-density-') &&
                String(path).endsWith('/' + file)
              )
                throw new Error('candidate storage fault');
              return original(path, flags, mode);
            });
          try {
            await expect(
              history.restoreRawHistorySnapshot(snapshot),
            ).rejects.toThrow('candidate storage fault');
          } finally {
            open.mockRestore();
          }
          const blocks: unknown[] = [];
          for await (const row of history.streamRawHistory())
            blocks.push(row.blocks);
          expect(blocks).toStrictEqual([rollbackRow(1).blocks]);
          expect(
            fs
              .readdirSync(tmpdir())
              .filter(
                (name) =>
                  name.startsWith('history-density-') && !before.includes(name),
              ),
          ).toStrictEqual([]);
        });
      });
    },
  );
});
