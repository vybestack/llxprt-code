/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { JournalGroupWriter } from '@vybestack/llxprt-code-core/journal/groupWriter.js';
import { loadFlushRecords } from '@vybestack/llxprt-code-core/journal/flushRecords.js';
import { RECORD_KIND } from '@vybestack/llxprt-code-core/journal/recordKinds.js';
import type { JournalFileHandle } from '@vybestack/llxprt-code-core/journal/positionalFile.js';
import type { JournalSessionOptions } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import * as fsp from 'node:fs/promises';

export interface IoCount {
  groups: number;
  records: number;
  rowBytes: number;
  flushes: number;
  writes: number;
  writtenBytes: number;
  preads: number;
  readBytes: number;
}

function empty(): IoCount {
  return {
    groups: 0,
    records: 0,
    rowBytes: 0,
    flushes: 0,
    writes: 0,
    writtenBytes: 0,
    preads: 0,
    readBytes: 0,
  };
}

export interface IoSnapshot {
  readonly primary: IoCount;
  readonly mirror: IoCount;
}

export function ioDifference(
  after: IoSnapshot,
  before: IoSnapshot,
): IoSnapshot {
  const difference = (a: IoCount, b: IoCount): IoCount => ({
    groups: a.groups - b.groups,
    records: a.records - b.records,
    rowBytes: a.rowBytes - b.rowBytes,
    flushes: a.flushes - b.flushes,
    writes: a.writes - b.writes,
    writtenBytes: a.writtenBytes - b.writtenBytes,
    preads: a.preads - b.preads,
    readBytes: a.readBytes - b.readBytes,
  });
  return {
    primary: difference(after.primary, before.primary),
    mirror: difference(after.mirror, before.mirror),
  };
}

function handleObserver(totals: IoSnapshot): {
  watch(handle: JournalFileHandle, kind: keyof IoSnapshot): JournalFileHandle;
  count(fd: number): IoCount;
} {
  const handles = new WeakSet<JournalFileHandle>();
  const kinds = new Map<number, keyof IoSnapshot>();
  return {
    count: (fd) => totals[kinds.get(fd) ?? 'primary'],
    watch: (handle, kind) => {
      if (handles.has(handle)) return handle;
      handles.add(handle);
      kinds.set(handle.fd, kind);
      const count = totals[kind];
      const read = handle.read.bind(handle);
      const write = handle.write.bind(handle);
      const writev = handle.writev.bind(handle);
      handle.read = async (buffer, offset, length, position) => {
        const result = await read(buffer, offset, length, position);
        count.preads++;
        count.readBytes += result.bytesRead;
        return result;
      };
      handle.write = async (buffer, offset, length, position) => {
        const result = await write(buffer, offset, length, position);
        count.writes++;
        count.writtenBytes += result.bytesWritten;
        return result;
      };
      handle.writev = async (buffers, position) => {
        const result = await writev(buffers, position);
        count.writes++;
        count.writtenBytes += result.bytesWritten;
        return result;
      };
      return handle;
    },
  };
}

export async function observeWholeProductIo(): Promise<{
  snapshot(): IoSnapshot;
  restore(): void;
}> {
  const totals = { primary: empty(), mirror: empty() };
  const handles = handleObserver(totals);
  const flush = await loadFlushRecords();
  const create = JournalSession.create;
  const open = JournalSession.open;
  const bare = JournalSession.createUnlinked;
  const commit = JournalGroupWriter.prototype.prepareGroup;
  const options = (
    input: JournalSessionOptions = {},
  ): JournalSessionOptions => ({
    ...input,
    journal: {
      ...input.journal,
      open: async (path, flags) =>
        handles.watch(await fsp.open(path, flags), 'mirror'),
      flush: (fd): void => {
        flush(fd);
        handles.count(fd).flushes++;
      },
    },
  });
  JournalSession.create = (path, input) =>
    create.call(JournalSession, path, options(input));
  JournalSession.open = (path, input) =>
    open.call(JournalSession, path, options(input));
  JournalSession.createUnlinked = (input) =>
    bare.call(JournalSession, options(input));
  JournalGroupWriter.prototype.prepareGroup = function (build) {
    const handle = this.currentFile().handle;
    handles.watch(handle, 'primary');
    const count = handles.count(handle.fd);
    return commit.call(this, async (appender) => {
      const append = appender.append.bind(appender);
      appender.append = async (record) => {
        const offset = await append(record);
        count.records++;
        if (record.kind === RECORD_KIND.ROW)
          count.rowBytes += record.body?.length ?? 0;
        return offset;
      };
      const state = await build(appender);
      if (state !== undefined) count.groups++;
      return state;
    });
  };
  return {
    snapshot: () => ({
      primary: { ...totals.primary },
      mirror: { ...totals.mirror },
    }),
    restore: (): void => {
      JournalSession.create = create;
      JournalSession.open = open;
      JournalSession.createUnlinked = bare;
      JournalGroupWriter.prototype.prepareGroup = commit;
    },
  };
}
