/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { VectoredRecordAppender } from './groupAppender.js';
import { createFileHandleReader } from './positionalFile.js';
import { createRecordAccess } from './recordAccess.js';
import {
  TranscriptTreeWriter,
  firstTranscriptEntry,
  transcriptEntries,
  type TranscriptEntry,
} from './transcript-tree.js';
import {
  decodeTranscriptHead,
  encodeTranscriptHead,
  decodeMembership,
  encodeMembership,
} from './transcript-head.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function entry(id: bigint): TranscriptEntry {
  return {
    transcriptId: id,
    rowRef: Number(id) * 100,
    recordLength: 10,
    label: id * 1024n,
    revision: 1,
    audience: 0,
    status: 1,
    attemptRef: 0,
    supersedesId: 0n,
    presentationRef: 0,
  };
}

describe('transcript index primitives', () => {
  const dir = useTempDir('transcript-tree-');

  it('seeks across split leaves in either direction and preserves body identities after reopen', async () => {
    const file = join(dir(), 'tree.llxj');
    const handle = await open(file, 'wx+');
    let root = 0;
    let end = 64;
    try {
      const appender = new VectoredRecordAppender(handle, 64);
      const access = () =>
        createRecordAccess(file, createFileHandleReader(handle), {
          selfOffset: 0,
          durableEnd: appender.nextOffset,
        });
      const tree = new TranscriptTreeWriter(access, appender, 'transcript');
      for (let id = 1n; id <= 1025n; id++)
        root = await tree.insert(root, entry(id));
      expect((await tree.findRowRef(root, 51300)).transcriptId).toBe(513n);
      await appender.drain();
      end = appender.nextOffset;
    } finally {
      await handle.close();
    }
    const reader = await open(file, 'r');
    try {
      const access = createRecordAccess(file, createFileHandleReader(reader), {
        selfOffset: 0,
        durableEnd: end,
      });
      const forward: bigint[] = [];
      for await (const row of transcriptEntries(
        access,
        root,
        'transcript',
        511n,
        false,
      )) {
        forward.push(row.transcriptId);
        if (forward.length === 5) break;
      }
      const backward: bigint[] = [];
      for await (const row of transcriptEntries(
        access,
        root,
        'transcript',
        514n,
        true,
      )) {
        backward.push(row.transcriptId);
        if (backward.length === 5) break;
      }
      expect(forward).toStrictEqual([511n, 512n, 513n, 514n, 515n]);
      expect(backward).toStrictEqual([514n, 513n, 512n, 511n, 510n]);
    } finally {
      await reader.close();
    }
  });

  it('closes a point-seek iterator after consuming only its first entry', async () => {
    let closed = false;
    let pulled = 0;
    async function* entries(): AsyncGenerator<TranscriptEntry> {
      try {
        for (const id of [7n, 8n]) {
          pulled++;
          yield entry(id);
        }
      } finally {
        closed = true;
      }
    }

    expect((await firstTranscriptEntry(entries()))?.rowRef).toBe(700);
    expect(pulled).toBe(1);
    expect(closed).toBe(true);
  });

  it('returns no first entry when a point seek is empty', async () => {
    async function* entries(): AsyncGenerator<TranscriptEntry> {
      yield* [];
    }
    expect(await firstTranscriptEntry(entries())).toBeUndefined();
  });

  it('persists fixed-size heads and exact membership with u64 identities', () => {
    const head = {
      root: 100,
      count: 2,
      nextId: (1n << 60n) + 1n,
      openRoot: 0,
      reachableBytes: 500,
    };
    const member = {
      count: 2,
      label: 1024n,
      rowRef: 100,
      occurrencesRoot: 200,
    };
    expect(encodeTranscriptHead(head).length).toBe(40);
    expect(decodeTranscriptHead(encodeTranscriptHead(head))).toStrictEqual(
      head,
    );
    expect(decodeMembership(encodeMembership(member))).toStrictEqual(member);
    expect(decodeMembership(undefined).count).toBe(0);
  });
});
