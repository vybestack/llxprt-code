/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * StreamBatcher batches live streaming text/thought chunks from the agent turn
 * and flushes them to the ACP client as agent_message_chunk / agent_thought_chunk
 * session/update notifications on a short interval, routing every chunk through
 * the session's EmojiFilter (with blocked-response handling and a trailing
 * buffer flush).
 *
 * Extracted from zedIntegration.ts into its own module so the integration file
 * stays within the max-lines complexity budget; the behavior is unchanged and
 * fully exercised by zedIntegration.prompt.test.ts.
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { EmojiFilter } from '@vybestack/llxprt-code-core';

const BATCH_INTERVAL_MS = 100;

export class StreamBatcher {
  private pendingChunks: Array<{ kind: 'text' | 'thought'; text: string }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly emojiFilter: EmojiFilter,
    private readonly sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  ) {}

  append(text: string, isThought: boolean): void {
    const filterResult = isThought
      ? this.emojiFilter.filterText(text)
      : this.emojiFilter.filterStreamChunk(text);
    if (filterResult.blocked) {
      const pending = this.flushChain
        .then(() => this.doFlush())
        .then(() =>
          this.sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: '[Error: Response blocked due to emoji detection]',
            },
          }),
        );
      this.flushChain = pending.catch(() => undefined);
      return;
    }
    const filteredText =
      typeof filterResult.filtered === 'string' ? filterResult.filtered : '';
    if (filteredText.length === 0) {
      return;
    }
    this.appendPendingChunk(isThought ? 'thought' : 'text', filteredText);
    this.batchTimer ??= setTimeout(() => {
      this.batchTimer = null;
      void this.flush();
    }, BATCH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    const pending = this.flushChain
      .then(() => this.doFlush())
      .then(() => this.flushEmojiBuffer());
    this.flushChain = pending.catch(() => undefined);
    await pending;
  }

  private async flushEmojiBuffer(): Promise<void> {
    const remaining = this.emojiFilter.flushBuffer();
    if (remaining.length === 0) {
      return;
    }
    this.appendPendingChunk('text', remaining);
    await this.doFlush();
  }

  private appendPendingChunk(kind: 'text' | 'thought', text: string): void {
    const lastChunk = this.pendingChunks.at(-1);
    if (lastChunk?.kind === kind) {
      lastChunk.text += text;
      return;
    }
    this.pendingChunks.push({ kind, text });
  }

  private async doFlush(): Promise<void> {
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    for (const chunk of chunks) {
      await this.sendUpdate({
        sessionUpdate:
          chunk.kind === 'thought'
            ? 'agent_thought_chunk'
            : 'agent_message_chunk',
        content: { type: 'text', text: chunk.text },
      });
    }
  }
}
