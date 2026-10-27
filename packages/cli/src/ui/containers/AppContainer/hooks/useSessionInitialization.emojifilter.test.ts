/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import type { EmojiFilterMode, IContent } from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from '../../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { NativeJournalCursor } from '../../../stores/turn/native-journal-cursor.js';
import { EMOJI_BLOCKED_ERROR_TEXT } from '../../../utils/iContentToHistoryItems.js';
import type { HistoryItem } from '../../../types.js';

const resumed: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'nice \u{1F44D}' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] },
];

async function projected(
  mode: EmojiFilterMode | undefined,
  rows = resumed,
): Promise<HistoryItem[]> {
  let items: HistoryItem[] = [];
  await withRecordingLifetimeFixture(async ({ agent }) => {
    await agent.setHistory(rows);
    await agent.session.setRecording({ enabled: true });
    const path = agent.session.getRecording().path;
    if (!path) throw new Error('Missing resumed journal');
    const cursor = await NativeJournalCursor.open(
      path,
      { emojiFilterMode: mode },
      8,
    );
    try {
      items = (await cursor.pageBack(8)).entries
        .flatMap((entry) => (entry.kind === 'projected' ? [entry.item] : []))
        .reverse();
    } finally {
      await cursor.close();
    }
  });
  return items;
}

describe('resumed journal emoji filtering', () => {
  it('renders distinct thinking-only rows without merging their prefix-sharing text', async () => {
    const items = await projected('allowed', [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Plan',
            sourceField: 'thought',
            streamId: 'first',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Plan the next step',
            sourceField: 'thought',
            streamId: 'second',
          },
        ],
      },
    ]);
    expect(items).toHaveLength(2);
    const thoughts = items.flatMap((item) =>
      item.type === 'gemini' ? (item.thinkingBlocks ?? []) : [],
    );
    expect(thoughts.map((block) => block.thought)).toStrictEqual([
      'Plan',
      'Plan the next step',
    ]);
    expect(thoughts.map((block) => block.streamId)).toStrictEqual([
      'first',
      'second',
    ]);
    expect(
      new Set(items.map((item) => JSON.stringify(item.rowIdentity))).size,
    ).toBe(2);
  });
  it('filters model text by default and preserves user text verbatim', async () => {
    const items = await projected(undefined);
    expect(items.map((item) => item.text)).toStrictEqual([
      'nice \u{1F44D}',
      'Done [OK]',
    ]);
    expect(items.every((item) => item.rowIdentity?.kind === 'journal')).toBe(
      true,
    );
  });
  it('keeps model emojis when allowed', async () => {
    expect((await projected('allowed')).map((item) => item.text)).toStrictEqual(
      ['nice \u{1F44D}', 'Done \u2705'],
    );
  });
  it('replaces blocked model text with the error at the same journal row', async () => {
    const items = await projected('error');
    expect(items.map((item) => [item.type, item.text])).toStrictEqual([
      ['user', 'nice \u{1F44D}'],
      ['error', EMOJI_BLOCKED_ERROR_TEXT],
    ]);
    expect(items[1].rowIdentity?.kind).toBe('journal');
  });
  it('puts warning feedback after the filtered model response', async () => {
    const items = await projected('warn');
    expect(items.map((item) => item.type)).toStrictEqual([
      'user',
      'gemini',
      'info',
    ]);
    expect(items[1].text).toBe('Done [OK]');
    expect(items[2].text).toContain('emoji');
  });
  it('blanks blocked thinking text without blocking a clean answer', async () => {
    const items = await projected('error', [
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'hmm \u2705' },
          { type: 'text', text: 'Answer' },
        ],
      },
    ]);
    expect(items[0]).toMatchObject({
      type: 'gemini',
      text: 'Answer',
      thinkingBlocks: [{ type: 'thinking', thought: '' }],
    });
  });
});
