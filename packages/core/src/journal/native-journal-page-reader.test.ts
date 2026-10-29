/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { open } from 'node:fs/promises';
import {
  NativeJournalPageReader,
  type NativeJournalReadDependencies,
} from '../../index.js';
import type { ToolCallBlock } from '../services/history/IContent.js';
import { JournalSession } from '../services/history/journalSession.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function countedReads(stats: {
  reads: number;
  bytes: number;
}): NativeJournalReadDependencies {
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
          stats.reads++;
          stats.bytes += length;
          return handle.read(buffer, offset, length, position);
        },
      };
    },
  };
}

describe('public native journal page reader', () => {
  const directory = useTempDir('native-page-reader-');
  it('reads a tool page without decoding other call payloads', async () => {
    const session = await JournalSession.create(
      join(directory(), 'tools.llxj'),
    );
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'before tools' },
            ...Array.from(
              { length: 8192 },
              (_, index): ToolCallBlock => ({
                type: 'tool_call',
                id: `call-${index}`,
                name: 'read_file',
                parameters: { index },
              }),
            ),
          ],
        },
      ]);
      const stats = { reads: 0, bytes: 0 };
      const reader = await NativeJournalPageReader.open(
        session.path,
        countedReads(stats),
      );
      try {
        const entry = await reader.entryAt(0);
        stats.reads = 0;
        stats.bytes = 0;
        const page = await reader.readToolPage(entry, 16, 16);
        expect(stats.reads).toBeLessThanOrEqual(6);
        expect(stats.bytes).toBeLessThan(entry.recordLength / 2);
        const firstPageBytes = stats.bytes;
        stats.reads = 0;
        stats.bytes = 0;
        expect((await reader.readToolPage(entry, 32, 16)).blocks).toHaveLength(
          16,
        );
        expect(stats.reads).toBeLessThanOrEqual(2);
        expect(stats.bytes).toBeLessThan(firstPageBytes / 4);
        expect(page.blocks).toHaveLength(16);
        expect(page.blocks[0]).toMatchObject({
          type: 'tool_call',
          id: 'call-16',
          parameters: { index: 16 },
        });
        expect(page.blocks[15]).toMatchObject({ id: 'call-31' });
        const first = await reader.readToolPage(entry, 0, 16);
        expect(first.blocks).toHaveLength(17);
        expect(first.blocks[0]).toStrictEqual({
          type: 'text',
          text: 'before tools',
        });
        expect(await reader.callIds(entry)).toHaveLength(8192);
      } finally {
        await reader.close();
      }
    } finally {
      await session.close();
    }
  });

  for (const calls of [40, 400]) {
    it(`does not reread the same opener for each of ${calls} tool calls`, async () => {
      const session = await JournalSession.create(
        join(directory(), `repeated-${calls}.llxj`),
      );
      try {
        await session.append([
          {
            speaker: 'ai',
            blocks: Array.from(
              { length: calls },
              (_, index): ToolCallBlock => ({
                type: 'tool_call',
                id: `call-${index}`,
                name: 'read_file',
                parameters: { index },
              }),
            ),
          },
        ]);
        const stats = { reads: 0, bytes: 0 };
        const reader = await NativeJournalPageReader.open(
          session.path,
          countedReads(stats),
        );
        try {
          const first = await reader.entryAt(0);
          stats.reads = 0;
          stats.bytes = 0;
          await Promise.all(
            Array.from({ length: Math.ceil(calls / 16) }, async () => {
              expect((await reader.entryAt(0)).toolCallBlocks).toBe(calls);
            }),
          );
          expect(stats.reads).toBeLessThanOrEqual(1);
          expect(stats.bytes).toBeLessThan(first.recordLength);
        } finally {
          await reader.close();
        }
      } finally {
        await session.close();
      }
    });
  }

  it('reads committed rows and selects responses within label bounds', async () => {
    const session = await JournalSession.create(join(directory(), 'page.llxj'));
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call',
              name: 'read_file',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call',
              toolName: 'read_file',
              result: 'first',
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call',
              toolName: 'read_file',
              result: 'last',
            },
          ],
        },
      ]);
      const reader = await NativeJournalPageReader.open(session.path);
      try {
        const first = await reader.entryAt(0);
        const last = await reader.entryAt(2);
        const selected = await reader.lastResponseLabel(
          'call',
          first.label,
          last.label + 1n,
        );
        expect(selected).toBe(last.label);
        expect(await reader.entryByLabel(last.label)).toStrictEqual(last);
        expect((await reader.readContent(last)).blocks).toStrictEqual([
          {
            type: 'tool_response',
            callId: 'call',
            toolName: 'read_file',
            result: 'last',
          },
        ]);
        expect(await reader.responseIds(last)).toStrictEqual(['call']);
        expect(reader.isTool(last)).toBe(true);
        expect(reader.rows).toBe(3);
      } finally {
        await reader.close();
      }
    } finally {
      await session.close();
    }
  });

  it('exposes an empty committed view without manufacturing a tree', async () => {
    const session = await JournalSession.create(
      join(directory(), 'empty.llxj'),
    );
    try {
      const reader = await NativeJournalPageReader.open(session.path);
      try {
        const entries = [];
        for await (const entry of reader.entries()) entries.push(entry);
        expect(entries).toStrictEqual([]);
        expect(await reader.clearBoundaryOffset()).toBeNull();
      } finally {
        await reader.close();
      }
    } finally {
      await session.close();
    }
  });
});
