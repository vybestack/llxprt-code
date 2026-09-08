import { describe, expect, it, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import { ToolCallStatus, type HistoryItemWithoutId } from '../types.js';
import {
  createEmojiFilter,
  EMOJI_BLOCKED_ERROR_TEXT,
  filterHistoryItems,
  iContentToHistoryItems,
  resolveEmojiFilterMode,
} from './iContentToHistoryItems.js';
import { assertHasType } from '../../test-utils/assertions.js';

describe('iContentToHistoryItems', () => {
  it('maps human text to user history item', () => {
    const input: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: 'user', text: 'Hello' });
  });

  it('maps ai text and model to gemini history item', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi!' }],
        metadata: { model: 'claude-4' },
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: 'Hi!',
      model: 'claude-4',
    });
  });

  it('maps ai thinking + text to gemini with thinking blocks', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'hmm' },
          { type: 'text', text: 'Answer' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: 'Answer',
      thinkingBlocks: [{ type: 'thinking', thought: 'hmm' }],
    });
  });

  it('maps tool call + tool response into tool group', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read_file',
            result: 'content',
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({ type: 'tool_group' });
    assertHasType(output[0], 'tool_group');
    expect(output[0].tools[0]).toMatchObject({
      callId: 'c1',
      name: 'read_file',
      resultDisplay: 'content',
      status: ToolCallStatus.Success,
    });
  });

  it('maps ai text + tool_call to gemini + tool_group', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Running tool' },
          { type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(2);
    expect(output[0]).toMatchObject({ type: 'gemini', text: 'Running tool' });
    expect(output[1]).toMatchObject({ type: 'tool_group' });
  });

  it('maps code block to markdown in gemini text', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'code', code: 'x=1', language: 'python' }],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: '```python\nx=1\n```',
    });
  });

  it('maps tool error response to error status', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'c1', name: 'run', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'run',
            result: { ok: false },
            error: 'Permission denied',
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'tool_group');
    expect(output[0].tools[0].status).toBe(ToolCallStatus.Error);
  });

  it('is safe when tool result stringify fails', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'c1', name: 'run', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'run',
            result: circular,
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'tool_group');
    expect(typeof output[0].tools[0].resultDisplay).toBe('string');
  });

  it('returns empty array for empty input', () => {
    expect(iContentToHistoryItems([])).toStrictEqual([]);
  });

  it('skips human message with only empty text blocks', () => {
    const input: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: '' }] },
    ];
    expect(iContentToHistoryItems(input)).toStrictEqual([]);
  });

  it('preserves original order of mixed text and code blocks', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'hello' },
          { type: 'code', code: 'const x = 1', language: 'ts' },
          { type: 'text', text: 'world' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'gemini',
      text: 'hello\n```ts\nconst x = 1\n```\nworld',
    });
  });

  it('concatenates consecutive text blocks without newlines (#2549)', () => {
    // A resumed AI turn can arrive as several fragmented text blocks (e.g. one
    // per streamed token). They represent flowing prose, not separate lines.
    // Separating them with newlines produced one-token-per-line rendering on
    // restore, so consecutive text blocks must be concatenated directly.
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'The' },
          { type: 'text', text: ' quick' },
          { type: 'text', text: ' brown' },
          { type: 'text', text: ' fox.' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe('The quick brown fox.');
    // No hard line breaks were inserted between the fragments.
    expect(output[0].text).not.toContain(String.fromCharCode(10));
  });

  it('keeps text and code blocks on separate lines when fragmented (#2549)', () => {
    // Text fragments still merge into flowing prose, but a code block remains a
    // distinct block-level paragraph (its fence needs a surrounding newline).
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Here' },
          { type: 'text', text: ' is code:' },
          { type: 'code', code: 'x=1', language: 'ts' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe(
      ['Here is code:', '```ts', 'x=1', '```'].join(String.fromCharCode(10)),
    );
  });

  it('does not add blank lines after text fragments ending in newlines (#2549)', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: ['First line', ''].join(String.fromCharCode(10)),
          },
          {
            type: 'text',
            text: ['Second line', ''].join(String.fromCharCode(10)),
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe(
      ['First line', 'Second line', ''].join(String.fromCharCode(10)),
    );
  });

  it('does not add a blank line before code when text supplies the newline (#2549)', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: ['Here is code:', ''].join(String.fromCharCode(10)),
          },
          { type: 'code', code: 'x=1', language: 'ts' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe(
      ['Here is code:', '```ts', 'x=1', '```'].join(String.fromCharCode(10)),
    );
  });

  it('silently drops tool response with no matching tool call', () => {
    const input: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'orphan',
            toolName: 'read_file',
            result: 'data',
          },
        ],
      },
    ];
    // Orphan responses are indexed but produce no visible items
    expect(iContentToHistoryItems(input)).toStrictEqual([]);
  });
});

describe('iContentToHistoryItems emoji filtering (#2888)', () => {
  // Emojis are written as escapes (U+2705 check mark, U+1F44D thumbs up) so
  // the source stays ASCII-stable.
  it('filters replayed model text by default (auto)', () => {
    const input: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] },
    ];

    const output = iContentToHistoryItems(input);

    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe('Done [OK]');
  });

  it('replays user text verbatim by default', () => {
    // The live path never filters user input, so replayed user text must
    // stay verbatim for the resumed view to match what rendered live.
    const input: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'nice \u{1F44D}' }] },
    ];

    const output = iContentToHistoryItems(input);

    assertHasType(output[0], 'user');
    expect(output[0].text).toBe('nice \u{1F44D}');
  });

  it('replays model text verbatim in allowed mode', () => {
    const input: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] },
    ];

    const output = iContentToHistoryItems(input, 'allowed');

    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe('Done \u2705');
  });

  it('replaces blocked model text with the live error item in error mode', () => {
    const input: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] },
    ];

    const output = iContentToHistoryItems(input, 'error');

    // Mirrors commitAiPendingItem: blocked turns render the same error item
    // the live path renders instead of a blank model item.
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      type: 'error',
      text: EMOJI_BLOCKED_ERROR_TEXT,
    });
  });

  it('appends the warn-mode feedback as an info item', () => {
    const input: IContent[] = [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Done \u2705' }] },
    ];

    const output = iContentToHistoryItems(input, 'warn');

    expect(output).toHaveLength(2);
    assertHasType(output[0], 'gemini');
    expect(output[0].text).toBe('Done [OK]');
    expect(output[1]).toMatchObject({
      type: 'info',
      text: 'Emojis were detected and removed. Please avoid using emojis.',
    });
  });

  it('filters thinking block text alongside model text', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'hmm \u2705' },
          { type: 'text', text: 'Answer \u2705' },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);

    assertHasType(output[0], 'gemini');
    const thinking = output[0].thinkingBlocks?.[0];
    expect(thinking?.thought).toBe('hmm [OK]');
  });

  it('leaves tool group items untouched', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read_file',
            result: '\u2705 data',
          },
        ],
      },
    ];

    const output = iContentToHistoryItems(input);

    assertHasType(output[0], 'tool_group');
    expect(output[0].tools[0].resultDisplay).toBe('\u2705 data');
  });
});

describe('resolveEmojiFilterMode', () => {
  it('returns the non-empty string setting', () => {
    const getEphemeralSetting = vi.fn().mockReturnValue('error');
    expect(resolveEmojiFilterMode({ getEphemeralSetting })).toBe('error');
    expect(getEphemeralSetting).toHaveBeenCalledWith('emojifilter');
  });

  it('defaults to auto for missing, empty, or non-string values', () => {
    expect(
      resolveEmojiFilterMode({ getEphemeralSetting: () => undefined }),
    ).toBe('auto');
    expect(resolveEmojiFilterMode({ getEphemeralSetting: () => '' })).toBe(
      'auto',
    );
    expect(resolveEmojiFilterMode({ getEphemeralSetting: () => 42 })).toBe(
      'auto',
    );
  });

  it('defaults to auto for unrecognized mode strings (validated like nonInteractiveCli)', () => {
    expect(
      resolveEmojiFilterMode({ getEphemeralSetting: () => 'alowed' }),
    ).toBe('auto');
    expect(
      resolveEmojiFilterMode({ getEphemeralSetting: () => 'strict' }),
    ).toBe('auto');
  });

  it('defaults to auto when no settings source is available', () => {
    expect(resolveEmojiFilterMode(null)).toBe('auto');
    expect(resolveEmojiFilterMode(undefined)).toBe('auto');
  });
});

describe('createEmojiFilter', () => {
  it('builds an auto-mode filter when the mode is absent', () => {
    expect(createEmojiFilter(undefined)).toBeDefined();
  });

  it('builds no filter in allowed mode', () => {
    expect(createEmojiFilter('allowed')).toBeUndefined();
  });
});

describe('filterHistoryItems', () => {
  const autoFilter = createEmojiFilter('auto');

  it('filters model text', () => {
    const output = filterHistoryItems(
      [{ type: 'gemini', text: 'Done \u2705' }],
      autoFilter,
    );
    expect(output).toStrictEqual([{ type: 'gemini', text: 'Done [OK]' }]);
  });

  it('passes user text through untouched', () => {
    const item: HistoryItemWithoutId = { type: 'user', text: 'nice \u{1F44D}' };
    expect(filterHistoryItems([item], autoFilter)).toStrictEqual([item]);
  });

  it('passes items without text through untouched', () => {
    const item: HistoryItemWithoutId = { type: 'tool_group', tools: [] };
    expect(filterHistoryItems([item], autoFilter)).toStrictEqual([item]);
  });

  it('replaces blocked model text with error and feedback items', () => {
    const errorFilter = createEmojiFilter('error');
    const output = filterHistoryItems(
      [{ type: 'gemini', text: 'Done \u2705' }],
      errorFilter,
    );
    expect(output).toStrictEqual([
      { type: 'error', text: EMOJI_BLOCKED_ERROR_TEXT },
    ]);
  });

  it('appends warn-mode feedback after the filtered item', () => {
    const warnFilter = createEmojiFilter('warn');
    const output = filterHistoryItems(
      [{ type: 'gemini', text: 'Done \u2705' }],
      warnFilter,
    );
    expect(output).toStrictEqual([
      { type: 'gemini', text: 'Done [OK]' },
      {
        type: 'info',
        text: 'Emojis were detected and removed. Please avoid using emojis.',
      },
    ]);
  });

  it('filters thinking blocks and blanks them when blocked', () => {
    // Live thought handling (applyThoughtToState) blanks a blocked thought
    // without affecting the turn itself; only main-text blocking replaces
    // the turn with the error item.
    const errorFilter = createEmojiFilter('error');
    const output = filterHistoryItems(
      [
        {
          type: 'gemini',
          text: 'no emoji',
          thinkingBlocks: [{ type: 'thinking', thought: 'hmm \u2705' }],
        },
      ],
      errorFilter,
    );
    expect(output).toStrictEqual([
      {
        type: 'gemini',
        text: 'no emoji',
        thinkingBlocks: [{ type: 'thinking', thought: '' }],
      },
    ]);

    const autoOutput = filterHistoryItems(
      [
        {
          type: 'gemini',
          text: 'ok',
          thinkingBlocks: [{ type: 'thinking', thought: 'hmm \u2705' }],
        },
      ],
      autoFilter,
    );
    expect(autoOutput).toStrictEqual([
      {
        type: 'gemini',
        text: 'ok',
        thinkingBlocks: [{ type: 'thinking', thought: 'hmm [OK]' }],
      },
    ]);
  });

  it('passes all items through when no filter is configured', () => {
    const items: HistoryItemWithoutId[] = [
      { type: 'gemini', text: 'Done \u2705' },
    ];
    expect(filterHistoryItems(items, undefined)).toBe(items);
  });
});
