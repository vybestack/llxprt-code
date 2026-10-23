/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import * as writerOpen from '@vybestack/llxprt-code-core/journal/journalWriterOpen.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { spyOn } from 'bun:test';
import { withRecordingLifetimeFixture } from './recording-owner-lifetime-fixture.js';

export {
  readJournalCheckpoints,
  readJournalFileFacts,
} from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';

export const withOldRecordingFixture: typeof withRecordingLifetimeFixture = (
  ...args
) => (() => withRecordingLifetimeFixture(...args))();
export const withNativeRecordingFixture: typeof withRecordingLifetimeFixture = (
  ...args
) => (() => withRecordingLifetimeFixture(...args))();

export async function nativeRows(path: string): Promise<IContent[]> {
  const reader = await openJournalReadOnly(path);
  try {
    const root = rowTreeRootOf(reader.trailer);
    const rows: IContent[] = [];
    if (root !== undefined)
      for await (const entry of iterateRowEntries(reader, root))
        rows.push(decodeStoredRow(await readStoredRow(reader, entry)));
    return rows;
  } finally {
    await reader.close();
  }
}

export function rowTexts(rows: readonly IContent[]): string[] {
  return rows.map((row) =>
    row.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(''),
  );
}

export function requireRecordingPath(path: string | undefined): string {
  if (path === undefined) throw new Error('Recording did not materialize');
  return path;
}

export interface NativeFileControl {
  writeError?: Error;
  flushError?: Error;
  writeGate?: () => Promise<void>;
}

export function nativeRecordingFiles(
  directory: string,
  control: NativeFileControl,
): () => void {
  const resolve = writerOpen.resolveJournalDependencies;
  const recorderFds = new Set<number>();
  const seam = spyOn(
    writerOpen,
    'resolveJournalDependencies',
  ).mockImplementation(async (overrides) => {
    const dependencies = await resolve(overrides);
    return {
      ...dependencies,
      open: async (path, flags) => {
        const handle = await dependencies.open(path, flags);
        if (!path.startsWith(`${directory}/`) || flags === 'r') return handle;
        recorderFds.add(handle.fd);
        const beforeWrite = async (): Promise<void> => {
          await control.writeGate?.();
          if (control.writeError !== undefined) throw control.writeError;
        };
        return {
          fd: handle.fd,
          read: (buffer, offset, length, position) =>
            handle.read(buffer, offset, length, position),
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: async () => {
            recorderFds.delete(handle.fd);
            await handle.close();
          },
          write: async (buffer, offset, length, position) => {
            await beforeWrite();
            return handle.write(buffer, offset, length, position);
          },
          writev: async (buffers, position) => {
            await beforeWrite();
            return handle.writev(buffers, position);
          },
        };
      },
      flush: (fd) => {
        if (recorderFds.has(fd) && control.flushError !== undefined)
          throw control.flushError;
        dependencies.flush(fd);
      },
    };
  });
  return () => seam.mockRestore();
}
