/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import type { JournalSessionOptions } from '../packages/core/src/services/history/journalSession.js';

export class NativeRecordingProbe {
  private pendingBytes = 0;
  private observe: (() => Promise<void>) | undefined;

  readonly options: JournalSessionOptions = {
    journal: {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          read: (buffer, offset, length, position) =>
            handle.read(buffer, offset, length, position),
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: (buffer, offset, length, position) =>
            this.withBytes(length, () =>
              handle.write(buffer, offset, length, position),
            ),
          writev: (buffers, position) =>
            this.withBytes(
              buffers.reduce((total, buffer) => total + buffer.byteLength, 0),
              async () => {
                const result = await handle.writev(buffers, position);
                return { bytesWritten: result.bytesWritten };
              },
            ),
        };
      },
    },
  };

  getPendingByteCount(): number {
    return this.pendingBytes;
  }

  async measureWrite(
    write: () => Promise<void>,
    observe: () => Promise<void>,
  ): Promise<void> {
    if (this.observe !== undefined)
      throw new Error('A native write observation is already armed');
    this.observe = observe;
    try {
      await write();
      if (this.observe !== undefined)
        throw new Error('Native recording produced no write to observe');
    } finally {
      this.observe = undefined;
    }
  }

  private async withBytes<T>(
    bytes: number,
    write: () => Promise<T>,
  ): Promise<T> {
    this.pendingBytes += bytes;
    const observe = this.observe;
    this.observe = undefined;
    try {
      await observe?.();
      return await write();
    } finally {
      this.pendingBytes -= bytes;
    }
  }
}
