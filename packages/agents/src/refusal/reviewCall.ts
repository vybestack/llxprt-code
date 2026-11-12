/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { aggregateTextFromBlocks } from '../compression/utils.js';

/** Longest a reviewer may take to answer before the review is given up. */
export const REVIEW_TIMEOUT_MS = 120_000;

/** What the review call needs from a provider: one streamed chat call. */
export interface ReviewProvider {
  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterable<IContent>;
}

export interface ReviewCallResult {
  readonly text: string;
  readonly usage?: UsageStats;
  readonly finishReason?: string;
  readonly rawStopReason?: string;
}

export class ReviewTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the reviewer did not answer within ${timeoutMs / 1000} s`);
    this.name = 'ReviewTimeoutError';
  }
}

/** A promise that rejects when the deadline passes or the signal aborts. */
function deadline(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): { readonly expired: Promise<never>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ReviewTimeoutError(timeoutMs)),
      timeoutMs,
    );
    onAbort = () =>
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Review aborted', 'AbortError'),
      );
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  // The race below owns the rejection; this keeps an unobserved one quiet.
  expired.catch(() => undefined);
  return {
    expired,
    cancel: () => {
      clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * One tool-less provider call for the reviewer. It talks to the provider
 * directly instead of going through the chat turn loop, so it has no history
 * commit, no refusal recovery of its own and no retry of the refused request.
 * The call is abandoned at the deadline or when `signal` aborts, even if the
 * provider stream never yields again.
 */
export async function callReviewProvider(
  provider: ReviewProvider,
  options: RuntimeGenerateChatOptions,
  limits: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<ReviewCallResult> {
  const guard = deadline(limits.timeoutMs, limits.signal);
  const iterator = provider
    .generateChatCompletion(options)
    [Symbol.asyncIterator]();
  let text = '';
  let lastBlockWasNonText = false;
  let usage: UsageStats | undefined;
  let finishReason: string | undefined;
  let rawStopReason: string | undefined;
  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), guard.expired]);
      if (next.done === true) break;
      const aggregated = aggregateTextFromBlocks(
        next.value.blocks,
        text,
        lastBlockWasNonText,
      );
      text = aggregated.text;
      lastBlockWasNonText = aggregated.lastBlockWasNonText;
      usage = next.value.metadata?.usage ?? usage;
      finishReason = next.value.metadata?.finishReason ?? finishReason;
      rawStopReason = next.value.metadata?.rawStopReason ?? rawStopReason;
    }
  } finally {
    guard.cancel();
    // Closing the stream must not hold the caller if the provider ignores it.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
  return {
    text,
    ...(usage !== undefined && { usage }),
    ...(finishReason !== undefined && { finishReason }),
    ...(rawStopReason !== undefined && { rawStopReason }),
  };
}
