/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { AgentMessage } from '@vybestack/llxprt-code-agents';
import { bindCopyCommandHistoryRead } from './copyCommandHost.js';
import { createCopyCommand } from './copyCommand.js';

async function copyHistory(
  history: readonly AgentMessage[],
  initialized = true,
): Promise<{
  readonly result: unknown;
  readonly clipboard: readonly string[];
}> {
  const clipboard: string[] = [];
  const command = createCopyCommand(
    bindCopyCommandHistoryRead(
      () => initialized,
      async function* () {
        yield* history;
      },
    ),
    async (text) => {
      clipboard.push(text);
    },
  );
  return { result: await command.action(), clipboard };
}

const copied = {
  type: 'message',
  messageType: 'info',
  content: 'Last output copied to the clipboard',
};

describe('copy history scenario conservation', () => {
  it('should copy last AI message to clipboard successfully', async () => {
    const { result, clipboard } = await copyHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hi there! How can I help you?' }],
      },
    ]);
    expect(result).toStrictEqual(copied);
    expect(clipboard).toStrictEqual(['Hi there! How can I help you?']);
  });

  it('should handle multiple text parts in AI message', async () => {
    const { result, clipboard } = await copyHistory([
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Part 1: ' },
          { type: 'text', text: 'Part 2: ' },
          { type: 'text', text: 'Part 3' },
        ],
      },
    ]);
    expect(clipboard).toStrictEqual(['Part 1: Part 2: Part 3']);
    expect(result).toStrictEqual(copied);
  });

  it('should filter out non-text parts', async () => {
    const { result, clipboard } = await copyHistory([
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
          { type: 'text', text: ' more text' },
        ],
      },
    ]);
    expect(clipboard).toStrictEqual(['Text part more text']);
    expect(result).toStrictEqual(copied);
  });

  it('should get the last AI message when multiple AI messages exist', async () => {
    const { result, clipboard } = await copyHistory([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'First AI response' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'User message' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'Second AI response' }] },
    ]);
    expect(clipboard).toStrictEqual(['Second AI response']);
    expect(result).toStrictEqual(copied);
  });

  it('should return info message when no text parts found in AI message', async () => {
    const { result, clipboard } = await copyHistory([
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
      messageType: 'info',
      content: 'Last AI output contains no text to copy.',
    });
    expect(clipboard).toStrictEqual([]);
  });

  it('should handle unavailable config service', async () => {
    const { result, clipboard } = await copyHistory([], false);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No chat history available yet',
    });
    expect(clipboard).toStrictEqual([]);
  });

  it('should return info message when history is empty', async () => {
    const { result, clipboard } = await copyHistory([]);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No output in history',
    });
    expect(clipboard).toStrictEqual([]);
  });

  it('should return info message when no AI messages are found in history', async () => {
    const { result, clipboard } = await copyHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ]);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No output in history',
    });
    expect(clipboard).toStrictEqual([]);
  });
});
