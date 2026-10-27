/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JournalSession,
  type NativeJournalReadDependencies,
} from '@vybestack/llxprt-code-core';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { rowIdentityKey } from '../../utils/rowIdentity.js';

function boundedReads(stats: { bytes: number }): NativeJournalReadDependencies {
  return {
    open: async (path, flags) => {
      const handle = await open(path, flags);
      return {
        fd: handle.fd,
        stat: () => handle.stat(),
        truncate: (length) => handle.truncate(length),
        close: () => handle.close(),
        write: (buffer, offset, length, position) =>
          handle.write(buffer, offset, length, position),
        writev: (buffers, position) => handle.writev(buffers, position),
        read: (buffer, offset, length, position) => {
          if (length > 65536) throw new Error(`Whole-row buffering: ${length}`);
          stats.bytes += length;
          return handle.read(buffer, offset, length, position);
        },
      };
    },
  };
}

describe('giant journal text rows', () => {
  const directory = useTempDir('journal-giant-text-');
  it('decodes bounded viewport slices with distinct identities instead of materializing the giant row', async () => {
    const text =
      'escaped "quote" \\ slash\n🌙漢字\t'.repeat(70000) + 'TAIL_SENTINEL';
    const session = await JournalSession.create(
      join(directory(), 'giant.llxj'),
    );
    try {
      await session.append([
        { speaker: 'ai', blocks: [{ type: 'text', text }] },
      ]);
      const stats = { bytes: 0 };
      const cursor = await NativeJournalCursor.open(
        session.path,
        { journal: boundedReads(stats) },
        2,
      );
      try {
        const page = (await cursor.pageBack(2)).entries;
        const items = page.flatMap((entry) =>
          entry.kind === 'projected' ? [entry.item] : [],
        );
        expect(items).toHaveLength(2);
        expect(
          items.every(
            (item) => typeof item.text === 'string' && item.text.length <= 8193,
          ),
        ).toBe(true);
        expect(items[0]?.text?.endsWith('TAIL_SENTINEL')).toBe(true);
        const keys = items.flatMap((item) =>
          item.rowIdentity ? [rowIdentityKey(item.rowIdentity)] : [],
        );
        expect(new Set(keys).size).toBe(2);
        expect(stats.bytes).toBeLessThan(
          Buffer.byteLength(JSON.stringify({ type: 'text', text })) * 1.2,
        );
        const older = (await cursor.pageBack(2)).entries;
        expect(older).toHaveLength(2);
        expect(
          older
            .flatMap((entry) =>
              entry.kind === 'projected' && entry.item.rowIdentity
                ? [rowIdentityKey(entry.item.rowIdentity)]
                : [],
            )
            .some((key) => keys.includes(key)),
        ).toBe(false);
      } finally {
        await cursor.close();
      }
    } finally {
      await session.close();
    }
  });
});
