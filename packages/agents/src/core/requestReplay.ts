/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { RAW_TOKEN_DELTA_SINK_KEY } from '@vybestack/llxprt-code-providers';

/**
 * What belongs to one attempt, not to the request: its cancellation signal,
 * the observers watching it and the sink for its raw token deltas.
 */
export interface AttemptPlumbing {
  readonly signal: AbortSignal | undefined;
  readonly onProviderError: RuntimeGenerateChatOptions['onProviderError'];
  readonly onStreamLiveness: RuntimeGenerateChatOptions['onStreamLiveness'];
  readonly requestContext: Record<string, unknown> | undefined;
  readonly rawTokenDeltaSink: unknown;
}

/**
 * The options a provider was handed, kept to send the same request again
 * (issue #4093). Copies the collections a provider or a later hook could
 * mutate. The prompt-envelope transport token is one-shot, so it is left out:
 * a resend projects the envelope again and gets its own.
 */
export function snapshotSentOptions(
  options: RuntimeGenerateChatOptions,
): RuntimeGenerateChatOptions {
  const { promptEnvelopeTransportToken: _spent, ...rest } = options;
  return {
    ...rest,
    contents: [...options.contents],
    ...(options.tools === undefined ? {} : { tools: [...options.tools] }),
    metadata: { ...options.metadata },
  };
}

/**
 * The kept request bound to a new attempt: the request data is exactly what
 * was sent, the plumbing is the new attempt's own.
 */
export function replayOptions(
  kept: RuntimeGenerateChatOptions,
  attempt: AttemptPlumbing,
): RuntimeGenerateChatOptions {
  return {
    ...kept,
    contents: [...kept.contents],
    ...(kept.tools === undefined ? {} : { tools: [...kept.tools] }),
    ...(kept.invocation === undefined
      ? {}
      : { invocation: { ...kept.invocation, signal: attempt.signal } }),
    onProviderError: attempt.onProviderError,
    onStreamLiveness: attempt.onStreamLiveness,
    metadata: {
      ...kept.metadata,
      abortSignal: attempt.signal,
      _retryRequestContext: attempt.requestContext,
      [RAW_TOKEN_DELTA_SINK_KEY]: attempt.rawTokenDeltaSink,
    },
  };
}
