/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: a stream idle timeout must stay distinguishable from a
 * user-initiated abort AND must never be retried (issue #2817 remediation).
 *
 * `StreamIdleTimeoutError` is the codified contract — `turn.ts` maps it to the
 * dedicated StreamIdleTimeout event, so it must not be collapsed into
 * `AbortError`. The error is intentionally outside the transient-network
 * classification and must not trigger a re-send.
 */

import { describe, expect, it } from '../testApi.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { readProviderStreamResponse } from './turnLogging.js';
import { shouldRetryStreamAttempt } from './turnAbortHelpers.js';
import type { SendMessageParams } from './chatSession.js';

function neverYieldingIterator(): AsyncIterable<IContent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<IContent>>(() => {}),
    }),
  };
}

async function readWithIdleTimeout(): Promise<unknown> {
  const iterator = neverYieldingIterator()[Symbol.asyncIterator]();

  try {
    await readProviderStreamResponse(
      iterator,
      new AbortController(),
      undefined,
      5,
    );
    throw new Error('expected the idle timeout to reject');
  } catch (error) {
    return error;
  }
}

describe('TurnProcessor stream idle timeout error contract (issue #2817)', () => {
  it('raises StreamIdleTimeoutError so it stays distinguishable from a user abort', async () => {
    const error = await readWithIdleTimeout();

    expect((error as { name?: unknown }).name).toBe('StreamIdleTimeoutError');
  });

  it('does not classify an idle timeout as a retryable transient network error', async () => {
    const error = await readWithIdleTimeout();
    const params = { message: [] } as unknown as SendMessageParams;

    expect(isNetworkTransientError(error)).toBe(false);
    expect(
      shouldRetryStreamAttempt(error, params, 0, { hasYieldedOutput: false }),
    ).toBe(false);
    expect(
      shouldRetryStreamAttempt(error, params, 0, { hasYieldedOutput: true }),
    ).toBe(false);
  });
});
