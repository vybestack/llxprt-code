/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3840 with the real EmojiFilter in its default `auto` mode. The batcher
 * decides whether a channel owes a paragraph break from what it actually sends
 * to the client, so text the filter removes or still holds must not count.
 */

import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { EmojiFilter } from '@vybestack/llxprt-code-core';
import { StreamBatcher } from './zed-stream-batcher.js';

function chunkText(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : '';
}

function createBatcher(): {
  batcher: StreamBatcher;
  message: string[];
  thought: string[];
} {
  const message: string[] = [];
  const thought: string[] = [];
  const batcher = new StreamBatcher(
    new EmojiFilter({ mode: 'auto' }),
    async (update: acp.SessionUpdate): Promise<void> => {
      if (update.sessionUpdate === 'agent_message_chunk') {
        message.push(chunkText(update.content));
      } else if (update.sessionUpdate === 'agent_thought_chunk') {
        thought.push(chunkText(update.content));
      }
    },
  );
  return { batcher, message, thought };
}

describe('StreamBatcher attempt boundaries with the default emoji filter (issue #3840)', () => {
  it('keeps the earlier text ahead of the break when the filter still holds it', async () => {
    const { batcher, message } = createBatcher();

    batcher.append('attempt1', false);
    batcher.markAttemptBoundary();
    batcher.append('attempt2', false);
    await batcher.flush();

    expect(message.join('')).toBe('attempt1\n\nattempt2');
  });

  it('adds no leading break to the message when the earlier attempt only held an emoji', async () => {
    const { batcher, message } = createBatcher();

    batcher.append('😀', false);
    batcher.markAttemptBoundary();
    batcher.append('answer', false);
    await batcher.flush();

    expect(message.join('')).toBe('answer');
  });

  it('adds no leading break to the thought when the earlier attempt only held an emoji', async () => {
    const { batcher, thought } = createBatcher();

    batcher.append('😀', true);
    batcher.markAttemptBoundary();
    batcher.append('later thoughts', true);
    await batcher.flush();

    expect(thought.join('')).toBe('later thoughts');
  });

  it('puts a break between filtered thinking of consecutive attempts', async () => {
    const { batcher, thought } = createBatcher();

    batcher.append('first thoughts', true);
    batcher.markAttemptBoundary();
    batcher.append('later thoughts', true);
    await batcher.flush();

    expect(thought.join('')).toBe('first thoughts\n\nlater thoughts');
  });

  it('keeps the break on the later text the filter holds until the final flush', async () => {
    const { batcher, message } = createBatcher();

    batcher.append('attempt1 ', false);
    await batcher.flush();
    batcher.markAttemptBoundary();
    batcher.append('attempt2', false);
    await batcher.flush();

    expect(message.join('')).toBe('attempt1 \n\nattempt2');
  });

  it('adds no break across a model call that ended with a tool result', async () => {
    const { batcher, message, thought } = createBatcher();

    batcher.append('before', false);
    batcher.append('before', true);
    await batcher.flush();
    batcher.endModelCall();
    batcher.markAttemptBoundary();
    batcher.append('after', false);
    batcher.append('after', true);
    await batcher.flush();

    expect(message.join('')).toBe('beforeafter');
    expect(thought.join('')).toBe('beforeafter');
  });
});
