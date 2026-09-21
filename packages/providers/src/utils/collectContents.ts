/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05b3
 *
 * Provider-side materialization of the streaming history contract
 * (issue #854): `generateChatCompletion` receives the conversation as an
 * `AsyncIterable<IContent>`, and each provider collects it here at its
 * entry point to build the request-scoped array its transport prep
 * consumes. P05b4 replaces this collection with true streamed request
 * bodies; until then this is the single sanctioned seam, not a per-provider
 * workaround.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Drain a provider-facing history stream into an ordered array.
 * Upstream errors propagate; the array is request-scoped and owned by
 * the caller.
 */
export async function collectContents(
  stream: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const contents: IContent[] = [];
  for await (const content of stream) {
    contents.push(content);
  }
  return contents;
}

/**
 * Discriminate a stream argument from a `GenerateChatOptions` object in the
 * legacy positional overload. Options objects never carry an async iterator.
 */
export function isAsyncIterableContents(
  value: AsyncIterable<IContent> | object,
): value is AsyncIterable<IContent> {
  return Symbol.asyncIterator in value;
}

/**
 * Re-open a collected history as the provider-facing stream. Every call to
 * `[Symbol.asyncIterator]` starts a fresh pass over the same request-scoped
 * array (issue #854), so retry, failover, and estimation boundaries collect
 * once and hand each consumer its own single-consumption view instead of
 * sharing one exhaustible iterator.
 */
/** Marks streams that re-open a resident array (replayable, not one-shot). */
const replayableContentsMarker = Symbol.for('llxprt.replayableContents');

export function replayableContents(
  contents: readonly IContent[],
): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of contents) {
        yield content;
      }
    },
    [replayableContentsMarker]: true,
  } as AsyncIterable<IContent>;
}

/**
 * True when the iterable re-opens a resident array (every iterator start is a
 * fresh pass over the same rows). Issue #854 P05b4: replayable sources may be
 * collected eagerly at normalization — nothing extra is retained — while
 * one-shot sources defer the drain to the transport's request-scoped lease.
 */
export function isReplayableContents(value: AsyncIterable<IContent>): boolean {
  const marked = (value as unknown as Record<symbol, unknown>)[
    replayableContentsMarker
  ];
  return marked === true;
}

/**
 * True when a generate-chat call supplies its history as a one-shot stream —
 * either the bare-stream form or an options object whose `contents` is a
 * non-replayable stream (issue #854 P05b4). Materialized arrays and
 * replayable streams over resident rows return false: collecting them
 * eagerly retains nothing and preserves pre-submission validation.
 */
export function isOneShotContentsSource(
  value: AsyncIterable<IContent> | object,
): boolean {
  let source: AsyncIterable<IContent> | undefined;
  if (isAsyncIterableContents(value)) {
    source = value;
  } else {
    const field = (value as { contents?: unknown }).contents;
    if (
      typeof field === 'object' &&
      field !== null &&
      isAsyncIterableContents(field)
    ) {
      source = field;
    }
  }
  return source !== undefined && !isReplayableContents(source);
}
