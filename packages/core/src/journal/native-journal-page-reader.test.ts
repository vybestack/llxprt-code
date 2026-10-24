/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { NativeJournalPageReader } from '../../index.js';
import { JournalSession } from '../services/history/journalSession.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('public native journal page reader', () => {
  const directory = useTempDir('native-page-reader-');

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
