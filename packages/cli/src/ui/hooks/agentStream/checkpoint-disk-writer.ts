/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { promises as nodeFs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface CheckpointFileHandle {
  writeFile: (
    source: AsyncIterable<string>,
    options: { signal?: AbortSignal },
  ) => Promise<void>;
  sync: () => Promise<void>;
  close: () => Promise<void>;
}

export interface FsOps {
  mkdir: typeof nodeFs.mkdir;
  open: (
    path: string,
    flags: string,
    mode: number,
  ) => Promise<CheckpointFileHandle>;
  rename: typeof nodeFs.rename;
  rm: typeof nodeFs.rm;
}

async function writeChunks(
  file: FileHandle,
  source: AsyncIterable<string>,
  signal?: AbortSignal,
): Promise<void> {
  for await (const chunk of source) {
    signal?.throwIfAborted();
    const buffer = Buffer.from(chunk, 'utf8');
    let offset = 0;
    while (offset < buffer.length) {
      signal?.throwIfAborted();
      const { bytesWritten } = await file.write(
        buffer,
        offset,
        buffer.length - offset,
      );
      if (bytesWritten === 0) throw new Error('Checkpoint write stalled');
      offset += bytesWritten;
    }
  }
}

export const checkpointFs: FsOps = {
  mkdir: nodeFs.mkdir,
  rename: nodeFs.rename,
  rm: nodeFs.rm,
  open: async (path, flags, mode) => {
    const file = await nodeFs.open(path, flags, mode);
    return {
      writeFile: (source, options) => writeChunks(file, source, options.signal),
      sync: () => file.sync(),
      close: () => file.close(),
    };
  },
};

export async function writeCheckpointAtomically(
  destination: string,
  source: AsyncIterable<string>,
  fsOps: FsOps,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const staged = `${destination}.${randomUUID()}.tmp`;
  const file = await fsOps.open(staged, 'wx', 0o600);
  try {
    await file.writeFile(source, { signal });
    signal?.throwIfAborted();
    await file.sync();
    await file.close();
    signal?.throwIfAborted();
    await fsOps.rename(staged, destination);
  } finally {
    try {
      await file.close();
    } finally {
      await fsOps.rm(staged, { force: true });
    }
  }
}
