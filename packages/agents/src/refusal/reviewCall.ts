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

function abortReasonOf(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('Review aborted', 'AbortError');
}

/**
 * The request's own cancellation, linked to the user's signal and the
 * deadline. The provider holds this signal, so ending the review also ends its
 * HTTP request instead of leaving it to run on.
 */
function linkedRequestSignal(
  timeoutMs: number,
  userSignal: AbortSignal | undefined,
): {
  readonly signal: AbortSignal;
  readonly expired: Promise<never>;
  readonly settle: (abandon: boolean) => void;
} {
  const controller = new AbortController();
  let rejectExpired: (reason: Error) => void = () => undefined;
  const expired = new Promise<never>((_, reject) => {
    rejectExpired = reject;
  });
  // The race in the caller owns the rejection; this keeps an unobserved one quiet.
  expired.catch(() => undefined);
  const end = (reason: Error): void => {
    rejectExpired(reason);
    controller.abort(reason);
  };
  const timer = setTimeout(
    () => end(new ReviewTimeoutError(timeoutMs)),
    timeoutMs,
  );
  const onUserAbort = (): void => end(abortReasonOf(userSignal));
  userSignal?.addEventListener('abort', onUserAbort, { once: true });
  return {
    signal: controller.signal,
    expired,
    settle: (abandon) => {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
      if (abandon && !controller.signal.aborted) {
        controller.abort(new DOMException('Review ended', 'AbortError'));
      }
    },
  };
}

/** The provider options with this request's cancellation on every path it reads. */
function withRequestSignal(
  options: RuntimeGenerateChatOptions,
  signal: AbortSignal,
): RuntimeGenerateChatOptions {
  return {
    ...options,
    ...(options.invocation === undefined
      ? {}
      : { invocation: { ...options.invocation, signal } }),
    metadata: { ...options.metadata, abortSignal: signal },
  };
}

/**
 * One tool-less provider call for the reviewer. It talks to the provider
 * directly instead of going through the chat turn loop, so it has no history
 * commit, no refusal recovery of its own and no retry of the refused request.
 * The call is abandoned at the deadline or when `signal` aborts, even if the
 * provider stream never yields again, and the provider's own request is
 * aborted with it. An already aborted `signal` never reaches the provider.
 */
export async function callReviewProvider(
  provider: ReviewProvider,
  options: RuntimeGenerateChatOptions,
  limits: { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<ReviewCallResult> {
  if (limits.signal?.aborted === true) throw abortReasonOf(limits.signal);
  const guard = linkedRequestSignal(limits.timeoutMs, limits.signal);
  const iterator = provider
    .generateChatCompletion(withRequestSignal(options, guard.signal))
    [Symbol.asyncIterator]();
  let text = '';
  let lastBlockWasNonText = false;
  let usage: UsageStats | undefined;
  let finishReason: string | undefined;
  let rawStopReason: string | undefined;
  let completed = false;
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
    completed = true;
  } finally {
    guard.settle(!completed);
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
