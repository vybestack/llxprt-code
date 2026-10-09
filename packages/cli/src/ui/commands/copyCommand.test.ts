/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  publicChat,
  publicCommandContext,
  PublicCursorHistory,
} from '../../__tests__/public-history-cursor.js';

const writes: string[] = [];
let clipboardError: unknown;
void mock.module('../utils/commandUtils.js', () => ({
  async copyToClipboard(text: string): Promise<void> {
    if (clipboardError !== undefined) throw clipboardError;
    writes.push(text);
  },
}));
const { copyCommand } = await import('./copyCommand.js');

function resetClipboard(): void {
  writes.length = 0;
  clipboardError = undefined;
}

function message(speaker: IContent['speaker'], ...texts: string[]): IContent {
  return { speaker, blocks: texts.map((text) => ({ type: 'text', text })) };
}

async function copyRows(rows: readonly IContent[]): Promise<unknown> {
  return withSuffixFixture(
    rows.length,
    async (history) =>
      copyCommand.action?.(publicCommandContext(publicChat(history)), ''),
    0,
    (index) => rows[index],
    undefined,
    (options) => new PublicCursorHistory(options),
  );
}

describe('copyCommand absent output', () => {
  beforeEach(resetClipboard);
  it('returns info when no chat has been initialized', async () => {
    const context = createMockCommandContext({
      services: {
        config: { getAgentClient: () => ({ hasChatInitialized: () => false }) },
      },
    });
    expect(await copyCommand.action?.(context, '')).toStrictEqual({
      type: 'message',
      content: 'No chat history available yet',
      messageType: 'info',
    });
    expect(writes).toHaveLength(0);
  });

  it('returns info when history is empty', async () => {
    expect(await copyRows([])).toStrictEqual({
      type: 'message',
      content: 'No output in history',
      messageType: 'info',
    });
    expect(writes).toHaveLength(0);
  });

  it('returns info when history has only human messages', async () => {
    expect(await copyRows([message('human', 'Hello')])).toStrictEqual({
      type: 'message',
      content: 'No output in history',
      messageType: 'info',
    });
    expect(writes).toHaveLength(0);
  });

  it('returns info when the config service is unavailable', async () => {
    expect(
      await copyCommand.action?.(
        createMockCommandContext({ services: { config: null } }),
        '',
      ),
    ).toStrictEqual({
      type: 'message',
      content: 'No chat history available yet',
      messageType: 'info',
    });
    expect(writes).toHaveLength(0);
  });
});

describe('copyCommand text selection', () => {
  beforeEach(resetClipboard);
  it('copies the last AI text and ignores a later human message', async () => {
    const result = await copyRows([
      message('human', 'Hello'),
      message('ai', 'Hi', ' there!'),
      message('human', 'Next'),
    ]);
    expect(writes).toStrictEqual(['Hi there!']);
    expect(result).toStrictEqual({
      type: 'message',
      content: 'Last output copied to the clipboard',
      messageType: 'info',
    });
  });

  it('concatenates all text parts without inserting separators', async () => {
    const result = await copyRows([
      message('ai', 'Part 1: ', 'Part 2: ', 'Part 3'),
    ]);
    expect(writes).toStrictEqual(['Part 1: Part 2: Part 3']);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });
});

describe('copyCommand mixed-block selection', () => {
  beforeEach(resetClipboard);
  it('ignores media, thinking and tool blocks between text parts', async () => {
    const result = await copyRows([
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Text part' },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            encoding: 'base64',
            data: 'base64data',
          },
          { type: 'thinking', thought: 'hidden' },
          { type: 'tool_call', id: 'call', name: 'read_file', parameters: {} },
          { type: 'text', text: ' more text' },
        ],
      },
    ]);
    expect(writes).toStrictEqual(['Text part more text']);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('replaces earlier AI output with the last AI message', async () => {
    const result = await copyRows([
      message('ai', 'First response'),
      message('human', 'Next'),
      message('ai', 'Second ', 'response'),
    ]);
    expect(writes).toStrictEqual(['Second response']);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Last output copied to the clipboard',
    });
  });

  it('does not fall back to an earlier text message when the last AI row is media-only', async () => {
    const result = await copyRows([
      message('ai', 'Old output'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/jpeg',
            encoding: 'base64',
            data: 'base64data',
          },
        ],
      },
    ]);
    expect(result).toStrictEqual({
      type: 'message',
      content: 'Last AI output contains no text to copy.',
      messageType: 'info',
    });
    expect(writes).toHaveLength(0);
  });
});

describe('copyCommand clipboard failures', () => {
  beforeEach(resetClipboard);
  it('reports an Error from clipboard infrastructure', async () => {
    clipboardError = new Error('Clipboard access denied');
    expect(await copyRows([message('ai', 'AI ', 'response')])).toStrictEqual({
      type: 'message',
      content: 'Failed to copy to the clipboard. Clipboard access denied',
      messageType: 'error',
    });
    expect(writes).toHaveLength(0);
  });

  it('reports non-Error clipboard failures', async () => {
    clipboardError = 'String error';
    expect(await copyRows([message('ai', 'AI ', 'response')])).toStrictEqual({
      type: 'message',
      content: 'Failed to copy to the clipboard. String error',
      messageType: 'error',
    });
    expect(writes).toHaveLength(0);
  });
});
