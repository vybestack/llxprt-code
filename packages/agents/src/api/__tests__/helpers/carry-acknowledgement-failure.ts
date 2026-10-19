/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import * as writerOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import { RECORD_KIND } from '@vybestack/llxprt-code-core/journal/recordKinds.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';

export function carryAcknowledgementFailure(message: string): {
  arm(): void;
  restore(): void;
  readonly rejectedTrailer:
    | { readonly path: string; readonly position: number }
    | undefined;
  readonly oldAcknowledgement:
    | ReturnType<typeof oldAcknowledgementFailure>
    | undefined;
} {
  if (selectBackend() === 'old') {
    let failure: ReturnType<typeof oldAcknowledgementFailure> | undefined;
    return {
      arm: () => {
        failure = oldAcknowledgementFailure(message);
      },
      restore: () => {
        failure?.mockRestore();
      },
      rejectedTrailer: undefined,
      get oldAcknowledgement() {
        return failure;
      },
    };
  }
  let armed = false;
  let rejectedTrailer: { path: string; position: number } | undefined;
  const resolve = writerOpen.resolveJournalDependencies;
  const seam = vi
    .spyOn(writerOpen, 'resolveJournalDependencies')
    .mockImplementation(async (overrides) => {
      const dependencies = await resolve(overrides);
      return {
        ...dependencies,
        open: async (path, flags) => {
          const handle = await dependencies.open(path, flags);
          if (flags === 'r') return handle;
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
                rejectedTrailer = { path, position };
                throw new Error(message);
              }
              return handle.write(buffer, offset, length, position);
            },
          };
        },
      };
    });
  return {
    arm: () => {
      armed = true;
    },
    restore: () => {
      seam.mockRestore();
    },
    get rejectedTrailer() {
      return rejectedTrailer;
    },
    oldAcknowledgement: undefined,
  };
}

function oldAcknowledgementFailure(
  message: string,
): ReturnType<
  typeof vi.spyOn<SessionRecordingService, 'waitForCommitSequence'>
> {
  return vi
    .spyOn(SessionRecordingService.prototype, 'waitForCommitSequence')
    .mockImplementationOnce(async () => {
      throw new Error(message);
    });
}
