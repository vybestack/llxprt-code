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
import { type EmojiFilter, DebugLogger } from '@vybestack/llxprt-code-core';

const BATCH_INTERVAL_MS = 100;

/**
 * The message emitted (as an agent_message_chunk) when the EmojiFilter blocks a
 * streamed response in error mode (FINDING E2). Exported so tests reference this
 * single source of truth instead of duplicating the literal, keeping the wire
 * text and its assertions in lockstep.
 */
export const STREAM_BLOCKED_MESSAGE =
  '[Error: Response blocked due to emoji detection]';

export class StreamBatcher {
  private pendingChunks: Array<{ kind: 'text' | 'thought'; text: string }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly logger: DebugLogger;

  constructor(
    private readonly emojiFilter: EmojiFilter,
    private readonly sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
    logger?: DebugLogger,
  ) {
    // Injectable for testability; defaults to the shared zed-integration
    // namespace so the otherwise-silent flush-chain / per-chunk failures
    // (FINDING F4/F17) are diagnosable.
    this.logger =
      logger ?? new DebugLogger('llxprt:zed-integration:stream-batcher');
  }

  append(text: string, isThought: boolean): void {
    if (this.disposed) {
      return;
    }
    const filterResult = isThought
      ? this.emojiFilter.filterText(text)
      : this.emojiFilter.filterStreamChunk(text);
    if (filterResult.blocked) {
      // FINDING F10: flush the EmojiFilter's residual buffer SYNCHRONOUSLY, right
      // now — NOT later in the async flushChain. The content that triggered the
      // block is still in the filter's internal buffer; if it is not cleared
      // before this append() returns, the NEXT synchronous append() re-combines
      // it with the following chunk and re-blocks the (otherwise clean) content.
      // flushBuffer() is synchronous. Any emittable residual is queued in order
      // ahead of the error update; in error mode (the only mode that blocks
      // stream chunks) the offending emoji content yields no emittable text and
      // is simply discarded, leaving the buffer clean for subsequent chunks.
      const residual = this.emojiFilter.flushBuffer();
      if (residual.length > 0) {
        this.appendPendingChunk('text', residual);
      }
      // FINDING E1: clear any pending batch timer BEFORE building the blocked
      // chain (exactly as flush() does). Otherwise a timer armed by a prior
      // normal chunk survives and later fires its own flush() — appending a
      // SECOND doFlush()+flushEmojiBuffer chain that races the blocked-path
      // chain, re-flushing already-flushed content after the error message. The
      // blocked path here already flushes the residual + queued chunks, so the
      // timer has nothing left to do.
      if (this.batchTimer !== null) {
        clearTimeout(this.batchTimer);
        this.batchTimer = null;
      }
      const pending = this.flushChain
        .then(() => this.doFlush())
        .then(() =>
          this.sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: STREAM_BLOCKED_MESSAGE,
            },
          }),
        );
      this.flushChain = this.settleChainLink(pending);
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
    this.flushChain = this.settleChainLink(pending);
    await pending;
  }

  /**
   * Clears any pending batch timer and drops buffered chunks so no timer fires
   * after the owning prompt completes/aborts (FINDING F9), and marks the batcher
   * disposed so a late {@link append} after the turn ends is a silent no-op
   * (nothing new can enter the flush chain). Idempotent and safe to call after
   * {@link flush}; it does NOT emit, so any pending chunks must be flushed first
   * (the prompt path flushes then disposes). An in-flight flush link is left to
   * settle naturally — it only drains the (now empty) pending queue.
   */
  dispose(): void {
    this.disposed = true;
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingChunks = [];
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
    let firstError: unknown = null;
    let failureCount = 0;
    // FINDING F4: iterate a detached local copy and CONTINUE past a per-chunk
    // send failure so a single rejecting sendUpdate does not drop every later
    // chunk. The injected sendUpdate is best-effort today (Session.sendUpdate
    // swallows), so this cannot reject in practice — but the injected contract
    // is not guaranteed, so no chunk is silently lost if it ever does. The first
    // error is collected + logged (not rethrown) to keep the flushChain intact.
    for (const chunk of chunks) {
      try {
        await this.sendUpdate({
          sessionUpdate:
            chunk.kind === 'thought'
              ? 'agent_thought_chunk'
              : 'agent_message_chunk',
          content: { type: 'text', text: chunk.text },
        });
      } catch (error) {
        failureCount += 1;
        if (firstError === null) {
          firstError = error;
        }
      }
    }
    if (firstError !== null) {
      this.logger.debug(
        () =>
          `doFlush: ${failureCount} chunk update(s) failed to send; the remaining chunks were still attempted (no chunk dropped). First error: ${
            firstError instanceof Error
              ? firstError.message
              : String(firstError)
          }`,
      );
    }
  }

  /**
   * Terminates a flush-chain link so a rejection cannot poison the serialized
   * chain for subsequent appends, while still surfacing the swallowed error via
   * the logger (FINDING F17) instead of discarding it silently.
   */
  private settleChainLink(pending: Promise<void>): Promise<void> {
    return pending.catch((error: unknown) => {
      this.logger.debug(
        () =>
          `flush chain link failed (swallowed to keep the batch chain alive): ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    });
  }
}
