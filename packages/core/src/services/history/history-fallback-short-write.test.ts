/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import {
  withRollbackFixture,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';

function partialSnapshotWrites(): () => void {
  const descriptors = new Set<number>();
  const originalOpen = fs.openSync;
  const originalWrite = fs.writeSync;
  const open = vi
    .spyOn(fs, 'openSync')
    .mockImplementation((path, flags, mode) => {
      const fd = originalOpen(path, flags, mode);
      if (String(path).includes('history-mutation-')) descriptors.add(fd);
      return fd;
    });
  const write = vi
    .spyOn(fs, 'writeSync')
    .mockImplementation(
      (
        fd: number,
        data: NodeJS.ArrayBufferView | string,
        offset?: number | null,
        length?: number | BufferEncoding | null,
        position?: number | null,
      ): number => {
        if (typeof data === 'string') {
          return originalWrite(
            fd,
            data,
            offset,
            typeof length === 'string' ? length : undefined,
          );
        }
        if (
          !ArrayBuffer.isView(data) ||
          typeof offset !== 'number' ||
          typeof length !== 'number'
        )
          throw new Error('Unexpected fixture write');
        return originalWrite(
          fd,
          data,
          offset,
          descriptors.has(fd) ? Math.min(7, length) : length,
          position,
        );
      },
    );
  return () => {
    write.mockRestore();
    open.mockRestore();
  };
}

describe('fallback partial filesystem writes', () => {
  it('completes short snapshot writes without changing serialized rows', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.transformRows(async (_source, sink) => {
        sink.appendDetached(rollbackRow(0));
        sink.appendDetached(rollbackRow(1));
      });
      await recorder.flush();
      const restore = partialSnapshotWrites();
      try {
        await history.withRawHistorySnapshot(async (snapshot) => {
          expect(snapshot.readRow(0).blocks).toStrictEqual(
            rollbackRow(0).blocks,
          );
          expect(snapshot.readRow(1).blocks).toStrictEqual(
            rollbackRow(1).blocks,
          );
          expect(snapshot.length).toBe(2);
        });
      } finally {
        restore();
      }
    });
  });
});
