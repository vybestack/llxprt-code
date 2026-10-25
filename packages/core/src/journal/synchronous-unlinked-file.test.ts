/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, writeSync } from 'node:fs';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { openSynchronousUnlinkedFile } from './synchronous-unlinked-file.js';
import { loadSynchronousFlushRecords } from './flushRecords.js';

describe('synchronous primary journal file', () => {
  const directory = useTempDir('synchronous-journal-');

  it('admits synchronously and serves asynchronous reads, writes and truncation on the same descriptor', async () => {
    const handle = openSynchronousUnlinkedFile(directory());
    try {
      expect(writeSync(handle.fd, new Uint8Array([1, 2]), 0, 2, 0)).toBe(2);
      expect(await handle.write(new Uint8Array([3]), 0, 1, 2)).toStrictEqual({
        bytesWritten: 1,
      });
      expect(
        await handle.writev([new Uint8Array([4]), new Uint8Array([5])], 3),
      ).toStrictEqual({ bytesWritten: 2 });
      loadSynchronousFlushRecords()(handle.fd);
      expect((await handle.stat()).size).toBe(5);
      const bytes = new Uint8Array(5);
      expect(await handle.read(bytes, 0, 5, 0)).toStrictEqual({ bytesRead: 5 });
      expect([...bytes]).toStrictEqual([1, 2, 3, 4, 5]);
      await handle.truncate(2);
      expect((await handle.stat()).size).toBe(2);
    } finally {
      await handle.close();
    }
    expect(readdirSync(directory())).toStrictEqual([]);
  });
});
