/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { EmojiFilter } from '@vybestack/llxprt-code-core';
import type * as acp from '@agentclientprotocol/sdk';

import { StreamBatcher } from './streamBatcher.js';

function createEmojiFilter(): EmojiFilter {
  return {
    filterText: (text: string) => ({ filtered: text, blocked: false }),
    filterStreamChunk: (text: string) => ({ filtered: text, blocked: false }),
    flushBuffer: () => '',
  } as EmojiFilter;
}

describe('StreamBatcher', () => {
  it('replaces same-stream thought updates before flushing', async () => {
    const sendUpdate = vi.fn<(update: acp.SessionUpdate) => Promise<void>>(
      async () => undefined,
    );
    const batcher = new StreamBatcher(createEmojiFilter(), sendUpdate);

    batcher.appendThought('First', 'reasoning-1');
    batcher.appendThought('second', 'reasoning-1');
    batcher.appendThought('thought', 'reasoning-1');

    await batcher.flush();

    expect(sendUpdate).toHaveBeenCalledTimes(1);
    expect(sendUpdate).toHaveBeenCalledWith({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thought' },
    });
  });

  it('keeps distinct thought stream ids as separate chunks', async () => {
    const sendUpdate = vi.fn<(update: acp.SessionUpdate) => Promise<void>>(
      async () => undefined,
    );
    const batcher = new StreamBatcher(createEmojiFilter(), sendUpdate);

    batcher.appendThought('First', 'reasoning-1');
    batcher.appendThought('Second', 'reasoning-2');

    await batcher.flush();

    expect(sendUpdate.mock.calls.map(([update]) => update)).toStrictEqual([
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'First' },
      },
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Second' },
      },
    ]);
  });

  it('propagates flush errors and allows subsequent flushes', async () => {
    const sendUpdate = vi
      .fn<(update: acp.SessionUpdate) => Promise<void>>()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(undefined);
    const batcher = new StreamBatcher(createEmojiFilter(), sendUpdate);

    batcher.append('First', false);
    await expect(batcher.flush()).rejects.toThrow('send failed');

    batcher.append('Second', false);
    await batcher.flush();

    expect(sendUpdate.mock.calls.map(([update]) => update)).toStrictEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'First' },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'FirstSecond' },
      },
    ]);
  });

  it('recovers after a mid-batch sendUpdate failure', async () => {
    const sendUpdate = vi
      .fn<(update: acp.SessionUpdate) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(undefined);
    const batcher = new StreamBatcher(createEmojiFilter(), sendUpdate);

    batcher.append('First', false);
    batcher.appendThought('Second', 'reasoning-1');
    await expect(batcher.flush()).rejects.toThrow('send failed');

    batcher.append('Third', false);
    await batcher.flush();

    expect(sendUpdate.mock.calls.map(([update]) => update)).toStrictEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'First' },
      },
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Second' },
      },
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Second' },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Third' },
      },
    ]);
  });
});
