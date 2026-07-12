/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { EmojiFilter } from '@vybestack/llxprt-code-core';

const BATCH_INTERVAL_MS = 100;

export class StreamBatcher {
  private pendingChunks: Array<{
    kind: 'text' | 'thought';
    text: string;
    streamId?: string;
  }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly emojiFilter: EmojiFilter,
    private readonly sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  ) {}

  append(text: string, isThought: boolean, streamId?: string): void {
    const filterResult = isThought
      ? this.emojiFilter.filterText(text)
      : this.emojiFilter.filterStreamChunk(text);
    if (filterResult.blocked) {
      this.clearBatchTimer();
      const pending = this.flushChain
        .then(() => this.doFlush())
        .then(() => this.flushEmojiBuffer())
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
    this.appendPendingChunk(
      isThought ? 'thought' : 'text',
      filteredText,
      isThought ? streamId : undefined,
    );
    this.batchTimer ??= setTimeout(() => {
      this.batchTimer = null;
      void this.flush().catch(() => undefined);
    }, BATCH_INTERVAL_MS);
  }

  appendThought(text: string, streamId?: string): void {
    this.append(text, true, streamId);
  }

  async flush(): Promise<void> {
    this.clearBatchTimer();
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

  private clearBatchTimer(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  private appendPendingChunk(
    kind: 'text' | 'thought',
    text: string,
    streamId?: string,
  ): void {
    if (kind === 'thought' && streamId !== undefined) {
      const existingChunk = this.pendingChunks.find(
        (chunk) => chunk.kind === 'thought' && chunk.streamId === streamId,
      );
      if (existingChunk !== undefined) {
        existingChunk.text = text;
        return;
      }
      this.pendingChunks.push({ kind, text, streamId });
      return;
    }

    const lastChunk = this.pendingChunks.at(-1);
    if (lastChunk?.kind === kind && lastChunk.streamId === undefined) {
      lastChunk.text += text;
      return;
    }
    this.pendingChunks.push({ kind, text });
  }

  private async doFlush(): Promise<void> {
    while (this.pendingChunks.length > 0) {
      const chunk = this.pendingChunks[0];
      await this.sendUpdate({
        sessionUpdate:
          chunk.kind === 'thought'
            ? 'agent_thought_chunk'
            : 'agent_message_chunk',
        content: { type: 'text', text: chunk.text },
      });
      this.pendingChunks.shift();
    }
  }
}
