/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as writerOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import * as unlinked from '@vybestack/llxprt-code-core/journal/synchronous-unlinked-file.js';
import type { JournalFileHandle } from '@vybestack/llxprt-code-core/journal/positionalFile.js';
import { RECORD_KIND } from '@vybestack/llxprt-code-core/journal/recordKinds.js';
import { fstatSync } from 'node:fs';
import { vi } from 'bun:test';

interface RejectedTrailer {
  readonly path: string;
  readonly position: number;
  readonly inode: number;
}

export function carryAcknowledgementFailure(message: string): {
  arm(): void;
  restore(): void;
  readonly rejectedTrailer: RejectedTrailer | undefined;
} {
  let armed = false;
  let rejectedTrailer: RejectedTrailer | undefined;
  function intercept(
    handle: JournalFileHandle,
    path: string,
  ): JournalFileHandle {
    return {
      fd: handle.fd,
      read: (buffer, offset, length, position) =>
        handle.read(buffer, offset, length, position),
      stat: () => handle.stat(),
      truncate: (length) => handle.truncate(length),
      close: () => handle.close(),
      writev: (buffers, position) => handle.writev(buffers, position),
      write: async (buffer, offset, length, position) => {
        if (armed && buffer[offset] === RECORD_KIND.TRAILER) {
          armed = false;
          rejectedTrailer = { path, position, inode: fstatSync(handle.fd).ino };
          throw new Error(message);
        }
        return handle.write(buffer, offset, length, position);
      },
    };
  }
  const openUnlinked = unlinked.openSynchronousUnlinkedFile;
  const synchronous = vi
    .spyOn(unlinked, 'openSynchronousUnlinkedFile')
    .mockImplementation((directory) =>
      intercept(openUnlinked(directory), '(unlinked)'),
    );
  const resolve = writerOpen.resolveJournalDependencies;
  const seam = vi
    .spyOn(writerOpen, 'resolveJournalDependencies')
    .mockImplementation(async (overrides) => {
      const dependencies = await resolve(overrides);
      return {
        ...dependencies,
        open: async (path, flags) => {
          const handle = await dependencies.open(path, flags);
          return flags === 'r' ? handle : intercept(handle, path);
        },
      };
    });
  return {
    arm: () => {
      armed = true;
    },
    restore: () => {
      seam.mockRestore();
      synchronous.mockRestore();
    },
    get rejectedTrailer() {
      return rejectedTrailer;
    },
  };
}
