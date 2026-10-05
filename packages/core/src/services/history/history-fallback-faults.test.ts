/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import {
  withRollbackFixture,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';

function scratch(): string[] {
  return fs
    .readdirSync(tmpdir())
    .filter(
      (name) =>
        name.startsWith('history-mutation-') ||
        name.startsWith('history-density-'),
    )
    .sort();
}
describe('fallback capture storage', () => {
  it('closes partially opened snapshot storage when the index cannot open', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.transformRows(async (_source, sink) => {
        sink.appendDetached(rollbackRow(0));
      });
      await recorder.flush();
      const before = scratch();
      const originalOpen = fs.openSync;
      const open = vi
        .spyOn(fs, 'openSync')
        .mockImplementation((path, flags, mode) => {
          if (
            String(path).includes('history-mutation-') &&
            String(path).endsWith('/index')
          )
            throw new Error('snapshot storage fault');
          return originalOpen(path, flags, mode);
        });
      try {
        await expect(
          history.withRawHistorySnapshot(async () => {
            throw new Error('unexpected consumer');
          }),
        ).rejects.toThrow('snapshot storage fault');
      } finally {
        open.mockRestore();
      }
      expect(scratch().filter((name) => !before.includes(name))).toStrictEqual(
        [],
      );
    });
  });
});

describe('fallback capture writes', () => {
  it('closes a failed snapshot write without publishing or changing history', async () => {
    await withRollbackFixture(async (history) => {
      history.add(rollbackRow(0));
      await history.waitForTokenUpdates();
      const before = scratch();
      const write = vi.spyOn(fs, 'writeSync').mockImplementationOnce(() => 0);
      try {
        await expect(
          history.withRawHistorySnapshot(async () => {
            throw new Error('unexpected publication');
          }),
        ).rejects.toThrow('Short numeric row write');
      } finally {
        write.mockRestore();
      }
      const blocks: unknown[] = [];
      for await (const row of history.streamRawHistory())
        blocks.push(row.blocks);
      expect(blocks).toStrictEqual([rollbackRow(0).blocks]);
      expect(scratch().filter((name) => !before.includes(name))).toStrictEqual(
        [],
      );
    });
  });
});

describe('fallback capture cancellation', () => {
  it('closes a mid-capture cancellation before calling the consumer', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.transformRows(async (_source, sink) => {
        for (let index = 0; index < 512; index++)
          sink.appendDetached(rollbackRow(index));
      });
      await recorder.flush();
      const before = scratch();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('mid-capture cancel')),
        0,
      );
      try {
        await expect(
          history.withRawHistorySnapshot(async () => {
            throw new Error('unexpected publication');
          }, controller.signal),
        ).rejects.toThrow('mid-capture cancel');
      } finally {
        clearTimeout(timer);
      }
      let rows = 0;
      for await (const _row of history.streamRawHistory()) rows++;
      expect(rows).toBe(512);
      expect(scratch().filter((name) => !before.includes(name))).toStrictEqual(
        [],
      );
    });
  }, 30000);
});
