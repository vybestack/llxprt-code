/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import type { IContent } from '@vybestack/llxprt-code-core';

function opener(seq: number): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'shared', name: 'read_file', parameters: {} },
    ],
    metadata: { chronology: { seq, userTurn: 1, step: 1, recordedAt: 0 } },
  };
}
function response(seq: number): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'shared',
        toolName: 'read_file',
        result: `result-${seq}`,
      },
    ],
    metadata: { chronology: { seq, userTurn: 1, step: 1, recordedAt: 0 } },
  };
}

describe('native scrollback response selection', () => {
  it('uses the last duplicate inside each group without borrowing a later group response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-response-index-'));
    const session = await JournalSession.create(
      join(directory, 'session.llxj'),
    );
    try {
      await session.append([
        opener(1),
        response(2),
        response(3),
        opener(4),
        response(5),
      ]);
      const cursor = await NativeJournalCursor.open(session.path, {}, 16);
      try {
        const page = await cursor.pageBack(16);
        const groups = page.entries.flatMap((entry) =>
          entry.kind === 'projected' && entry.item.type === 'tool_group'
            ? [
                {
                  span: entry.item.seqSpan,
                  results: entry.item.tools.map((tool) => tool.resultDisplay),
                },
              ]
            : [],
        );
        expect(groups).toStrictEqual([
          { span: [4, 5], results: ['result-5'] },
          { span: [1, 3], results: ['result-3'] },
        ]);
      } finally {
        await cursor.close();
      }
    } finally {
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
