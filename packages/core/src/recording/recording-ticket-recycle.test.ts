/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { dirname } from 'node:path';
import { RecordingTicketQueue } from './recording-ticket-queue.js';

function observeTicketDirectories(): {
  readonly directories: ReadonlySet<string>;
  restore(): void;
} {
  const directories = new Set<string>();
  const originalOpen = fs.openSync;
  const open = spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
    const fd = originalOpen(file, flags, mode);
    if (typeof file === 'string' && file.includes('history-value-ticket-'))
      directories.add(dirname(file));
    return fd;
  });
  return { directories, restore: () => open.mockRestore() };
}

describe('recording ticket recycling lifecycle', () => {
  it('reuses drained storage but deletes it on explicit clear and repeated close', () => {
    const observed = observeTicketDirectories();
    const queue = new RecordingTicketQueue();
    try {
      for (let seq = 1; seq <= 512; seq++) {
        const json = JSON.stringify({ seq, text: 'é😀'.repeat(seq) });
        const record = { seq, json, bytes: Buffer.byteLength(json) + 1 };
        queue.push(record);
        expect(queue.read(0)).toStrictEqual({
          ...record,
          staged: undefined,
          suffix: undefined,
        });
        queue.removeFirst();
        expect(queue.length).toBe(0);
      }
      expect(observed.directories.size).toBe(1);
      queue.clear();
      expect(
        [...observed.directories].every(
          (directory) => !fs.existsSync(directory),
        ),
      ).toBe(true);
      queue.close();
      queue.close();
      expect({
        length: queue.length,
        directories: [...observed.directories].filter((directory) =>
          fs.existsSync(directory),
        ),
      }).toStrictEqual({ length: 0, directories: [] });
    } finally {
      observed.restore();
      queue.close();
    }
  });
});
