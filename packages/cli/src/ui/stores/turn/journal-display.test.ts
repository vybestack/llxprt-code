/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { ToolCallStatus } from '../../types.js';

async function page(path: string) {
  const cursor = await NativeJournalCursor.open(path, {}, 16);
  try {
    return (await cursor.pageBack(16)).entries;
  } finally {
    await cursor.close();
  }
}

describe('journal presentation projection', () => {
  const directory = useTempDir('journal-display-ui-');

  it('pages UI-only notices with their classification and omits retracted notices', async () => {
    const path = join(directory(), 'notices.llxj');
    const session = await JournalSession.create(path);
    try {
      const writer = new JournalDisplayWriter(session.store);
      const transient = await writer.append({ type: 'info' }, 'temporary');
      await writer.append({ type: 'slash' }, 'command output');
      await writer.append({ type: 'error' }, 'failed command');
      await writer.retract(transient);
      const entries = await page(path);
      expect(
        entries.flatMap((entry) =>
          entry.kind === 'projected'
            ? [[entry.item.type, entry.item.text]]
            : [],
        ),
      ).toStrictEqual([
        ['error', 'failed command'],
        ['info', 'command output'],
      ]);
      expect(entries.map((entry) => entry.contextState)).toStrictEqual([
        'n/a',
        'n/a',
      ]);
    } finally {
      await session.close();
    }
  });

  it('keeps an acknowledged failed shell prefix readable', async () => {
    const path = join(directory(), 'failed-shell.llxj');
    const session = await JournalSession.create(path);
    const source = (async function* () {
      yield 'shell prefix before failure';
      throw new Error('shell source failed');
    })();
    try {
      await expect(
        new JournalDisplayWriter(session.store).append(
          { type: 'shell' },
          source,
        ),
      ).rejects.toThrow('shell source failed');
      const entries = await page(path);
      expect(
        entries.flatMap((entry) =>
          entry.kind === 'projected' ? [entry.item.text] : [],
        ),
      ).toStrictEqual(['shell prefix before failure']);
    } finally {
      await session.close();
    }
  });

  it('renders a completed tool presentation before its model response is committed', async () => {
    const path = join(directory(), 'presentation-before-response.llxj');
    const session = await JournalSession.create(path);
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'skill',
              name: 'activate_skill',
              parameters: {},
            },
          ],
        },
      ]);
      const reader = await NativeJournalPageReader.open(path);
      const transcriptId = (await reader.entryAt(0)).transcriptId.toString();
      await reader.close();
      await new JournalDisplayWriter(session.store).append(
        {
          type: 'tool-approval',
          attemptId: '',
          callId: 'skill',
          format: 'json',
        },
        JSON.stringify({
          request: { journalIdentity: { transcriptId, attemptId: '' } },
          status: 'scheduled',
        }),
      );
      await new JournalDisplayWriter(session.store).append(
        {
          type: 'tool-result',
          attemptId: '',
          callId: 'skill',
          format: 'text',
          status: 'success',
        },
        'Skill **pr-creator** activated.',
      );
      const entries = await page(path);
      const tools = entries.flatMap((entry) =>
        entry.kind === 'projected' && entry.item.type === 'tool_group'
          ? entry.item.tools
          : [],
      );
      expect(tools).toHaveLength(1);
      expect(tools[0].status).toBe(ToolCallStatus.Success);
      expect(tools[0].resultDisplay).toBe('Skill **pr-creator** activated.');
    } finally {
      await session.close();
    }
  });

  it('joins a distinct tool presentation through the disk relation without rendering a second row', async () => {
    const path = join(directory(), 'tools.llxj');
    const session = await JournalSession.create(path);
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call-one',
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
              callId: 'call-one',
              toolName: 'read_file',
              result: 'model result',
            },
          ],
        },
      ]);
      await new JournalDisplayWriter(session.store).append(
        {
          type: 'tool-result',
          attemptId: '',
          callId: 'call-one',
          format: 'text',
          displayName: 'Read File',
          description: 'example.ts',
          renderOutputAsMarkdown: false,
        },
        'distinct user-facing display',
      );
      const entries = await page(path);
      const groups = entries.flatMap((entry) =>
        entry.kind === 'projected' && entry.item.type === 'tool_group'
          ? [entry.item]
          : [],
      );
      expect(groups).toHaveLength(1);
      expect(groups[0].tools[0].resultDisplay).toBe(
        'distinct user-facing display',
      );
      expect(groups[0].tools[0].name).toBe('Read File');
      expect(groups[0].tools[0].description).toBe('example.ts');
      expect(groups[0].tools[0].renderOutputAsMarkdown).toBe(false);
      expect(entries).toHaveLength(1);
      const diff = {
        fileDiff: `-old
+new`,
        fileName: 'example.ts',
        originalContent: 'old',
        newContent: 'new',
      };
      await new JournalDisplayWriter(session.store).append(
        {
          type: 'tool-result',
          attemptId: '',
          callId: 'call-one',
          format: 'json',
        },
        JSON.stringify(diff),
      );
      const updated = await page(path);
      const tool = updated.flatMap((entry) =>
        entry.kind === 'projected' && entry.item.type === 'tool_group'
          ? entry.item.tools
          : [],
      );
      expect(tool[0].resultDisplay).toStrictEqual(diff);
      expect(updated).toHaveLength(1);
      expect(session.store.published?.rows).toBe(2);
    } finally {
      await session.close();
    }
  });
});
