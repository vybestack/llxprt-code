/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import * as writerOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import { RECORD_KIND } from '@vybestack/llxprt-code-core/journal/recordKinds.js';
import * as rowCounters from '@vybestack/llxprt-code-core/services/history/journalRowCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { gate } from './recording-finalizer-join-fixture.js';

export interface FinalizerFileGate {
  readonly kind: 'records' | 'trailer';
  readonly text?: string;
  readonly failure?: Error;
  readonly failFlush?: boolean;
}

interface FileState {
  readonly entered: ReturnType<typeof gate>;
  readonly release: ReturnType<typeof gate>;
  readonly handles: Set<number>;
  armed?: FinalizerFileGate;
  held?: { readonly path: string; readonly position: number };
  flushError?: Error;
  flushes: number;
}

async function beforeWrite(
  state: FileState,
  path: string,
  buffers: readonly Uint8Array[],
  position: number,
  trailer: boolean,
): Promise<void> {
  const boundary = state.armed;
  if (boundary === undefined || (boundary.kind === 'trailer') !== trailer)
    return;
  const text = boundary.text;
  if (
    text !== undefined &&
    !buffers.some((buffer) => Buffer.from(buffer).includes(text))
  )
    return;
  state.armed = undefined;
  state.held = { path, position };
  state.entered.release();
  await state.release.promise;
  if (boundary.failFlush === true) state.flushError = boundary.failure;
  else if (boundary.failure !== undefined) throw boundary.failure;
}

function wrapOpen(
  dependencies: writerOpen.JournalOpenDependencies,
  directory: string,
  state: FileState,
): writerOpen.JournalOpenDependencies['open'] {
  return async (path, flags) => {
    const handle = await dependencies.open(path, flags);
    if (!path.startsWith(`${directory}/`)) return handle;
    state.handles.add(handle.fd);
    return {
      fd: handle.fd,
      read: (buffer, offset, length, position) =>
        handle.read(buffer, offset, length, position),
      stat: () => handle.stat(),
      truncate: (length) => handle.truncate(length),
      close: async () => {
        await handle.close();
        state.handles.delete(handle.fd);
      },
      write: async (buffer, offset, length, position) => {
        await beforeWrite(
          state,
          path,
          [buffer.subarray(offset, offset + length)],
          position,
          buffer[offset] === RECORD_KIND.TRAILER,
        );
        return handle.write(buffer, offset, length, position);
      },
      writev: async (buffers, position) => {
        await beforeWrite(state, path, buffers, position, false);
        return handle.writev(buffers, position);
      },
    };
  };
}

export function nativeFinalizerFiles(directory: string): {
  arm(boundary: FinalizerFileGate): void;
  readonly entered: ReturnType<typeof gate>;
  readonly release: ReturnType<typeof gate>;
  readonly held:
    | { readonly path: string; readonly position: number }
    | undefined;
  readonly openHandles: number;
  readonly flushes: number;
  readonly ownership: RowOwnership;
  restore(): void;
} {
  const state: FileState = {
    entered: gate(),
    release: gate(),
    handles: new Set(),
    flushes: 0,
  };
  const ownership = new RowOwnership();
  const resolve = writerOpen.resolveJournalDependencies;
  const seam = spyOn(
    writerOpen,
    'resolveJournalDependencies',
  ).mockImplementation(async (overrides) => {
    const dependencies = await resolve(overrides);
    return {
      ...dependencies,
      open: wrapOpen(dependencies, directory, state),
      flush: (fd) => {
        if (state.handles.has(fd)) {
          state.flushes += 1;
          if (state.flushError !== undefined) throw state.flushError;
        }
        dependencies.flush(fd);
      },
    };
  });
  const count = rowCounters.countDecodedRow;
  const rows = spyOn(rowCounters, 'countDecodedRow').mockImplementation(
    (row, counters) => {
      const releaseRow = count(row, counters);
      ownership.retain(row);
      return () => {
        releaseRow();
        ownership.release(row);
      };
    },
  );
  return {
    arm: (boundary) => {
      state.armed = boundary;
    },
    entered: state.entered,
    release: state.release,
    ownership,
    get held() {
      return state.held;
    },
    get openHandles() {
      return state.handles.size;
    },
    get flushes() {
      return state.flushes;
    },
    restore: () => {
      rows.mockRestore();
      seam.mockRestore();
    },
  };
}
