/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3840: an `attempt-boundary` event must keep a later continuation
 * attempt's output off the earlier attempt's last line on the channel that
 * output uses: thinking goes out as agent_thought_chunk and text as
 * agent_message_chunk, and each channel concatenates on the client. Drives the
 * real handler with a real StreamBatcher and EmojiFilter.
 */

import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { EmojiFilter } from '@vybestack/llxprt-code-core';
import { handleZedAgentEvent } from './zed-agent-event-handler.js';
import { StreamBatcher } from './zed-stream-batcher.js';

function rejectUnexpected(name: string): () => never {
  return () => {
    throw new Error(`unexpected ${name} call`);
  };
}

function chunkText(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : '';
}

interface Streamed {
  /** What the client shows in the message and thought views. */
  readonly message: string;
  readonly thought: string;
}

async function stream(
  events: AgentEvent[],
  options: { flushAfterEachEvent?: boolean } = {},
): Promise<Streamed> {
  const message: string[] = [];
  const thought: string[] = [];
  const sendUpdate = async (update: acp.SessionUpdate): Promise<void> => {
    if (update.sessionUpdate === 'agent_message_chunk') {
      message.push(chunkText(update.content));
    } else if (update.sessionUpdate === 'agent_thought_chunk') {
      thought.push(chunkText(update.content));
    }
  };
  const batcher = new StreamBatcher(
    new EmojiFilter({ mode: 'allowed' }),
    sendUpdate,
  );
  for (const event of events) {
    await handleZedAgentEvent(event, batcher, {
      sendUpdate,
      sendUsage: rejectUnexpected('sendUsage'),
      handleConfirmation: rejectUnexpected('handleConfirmation'),
      resolveToolKind: () => undefined,
    });
    if (options.flushAfterEachEvent === true) await batcher.flush();
  }
  await batcher.flush();
  return { message: message.join(''), thought: thought.join('') };
}

const boundary: AgentEvent = { type: 'attempt-boundary' };

function think(text: string): AgentEvent {
  return { type: 'thinking', thought: { subject: '', description: text } };
}

describe('handleZedAgentEvent attempt boundaries (issue #3840)', () => {
  it('puts a paragraph break between continuation attempts in the message stream', async () => {
    const out = await stream([
      { type: 'text', text: 'attempt1' },
      boundary,
      { type: 'text', text: 'attempt2' },
    ]);

    expect(out.message).toBe('attempt1\n\nattempt2');
    expect(out.thought).toBe('');
  });

  it('puts a paragraph break between thinking of consecutive attempts in the thought stream', async () => {
    const out = await stream([
      think('first thoughts'),
      boundary,
      think('later thoughts'),
    ]);

    expect(out.thought).toBe('first thoughts\n\nlater thoughts');
    expect(out.message).toBe('');
  });

  it('keeps the thought break when the batcher flushed between the attempts', async () => {
    const out = await stream(
      [think('first thoughts'), boundary, think('later thoughts')],
      { flushAfterEachEvent: true },
    );

    expect(out.thought).toBe('first thoughts\n\nlater thoughts');
  });

  it('separates each channel from its own earlier output when an attempt thinks and then answers', async () => {
    const out = await stream([
      { type: 'text', text: 'READY' },
      boundary,
      think('wait'),
      { type: 'text', text: 'next' },
    ]);

    // Nothing was shown as thought before, so the thought opens clean; the
    // message channel still owes its break before the later attempt's text.
    expect(out.thought).toBe('wait');
    expect(out.message).toBe('READY\n\nnext');
  });

  it('adds no leading break to text that follows a thinking-only attempt', async () => {
    const out = await stream([
      think('pondering'),
      boundary,
      { type: 'text', text: 'first visible' },
    ]);

    expect(out.thought).toBe('pondering');
    expect(out.message).toBe('first visible');
  });

  it('does not double a break the text already ends with', async () => {
    const out = await stream([
      { type: 'text', text: 'attempt1\n\n' },
      boundary,
      { type: 'text', text: 'attempt2' },
    ]);

    expect(out.message).toBe('attempt1\n\nattempt2');
  });

  it('leaves a single attempt unchanged', async () => {
    const out = await stream([
      think('plan'),
      { type: 'text', text: 'only answer' },
    ]);

    expect(out.thought).toBe('plan');
    expect(out.message).toBe('only answer');
  });
});
