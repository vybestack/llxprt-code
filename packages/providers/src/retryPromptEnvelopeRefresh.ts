/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions, IProvider } from './IProvider.js';
import type { TransportAttemptBudget } from './transportAttemptBudget.js';
import { withRequestSignal } from './utils/abortSignal.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

/**
 * #3444: providers release a prepared prompt envelope when the attempt that
 * consumed it settles, so a retry must never replay the spent transport
 * token. Strip that token before minting a fresh retry projection:
 *   - provider cannot re-project → keep it stripped and degrade to
 *     unprojected re-resolution (the projection seam's own fallback);
 *   - projection throws → the error propagates into the surrounding
 *     attempt try/catch and is classified like any attempt failure;
 *   - a fresh token is minted → retain its idempotent `releaseIfUnsent`
 *     through adapter preparation and release on failure, even if the
 *     provider already released it. Successful attempts remain provider-owned.
 */
async function refreshPromptEnvelopeForRetry(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<{
  options: GenerateChatOptions;
  releaseIfUnsent: (() => Promise<void>) | undefined;
}> {
  if (options.promptEnvelopeTransportToken === undefined) {
    return { options, releaseIfUnsent: undefined };
  }
  const { promptEnvelopeTransportToken: _spentToken, ...unprojected } = options;
  const projection = await provider.projectPromptEnvelope?.(unprojected);
  if (projection === undefined) {
    return { options: unprojected, releaseIfUnsent: undefined };
  }
  return {
    options: {
      ...unprojected,
      promptEnvelopeTransportToken: projection.transportToken,
    },
    releaseIfUnsent: projection.releaseIfUnsent,
  };
}

export class RetryPromptEnvelopeRefresh {
  options: GenerateChatOptions | undefined;
  private unsentRelease: (() => Promise<void>) | undefined;
  private attempt = 0;
  recoveryConsumption = 0;

  canRetry(budget: TransportAttemptBudget, maxAttempts: number): boolean {
    return budget.used < budget.limit && this.recoveryConsumption < maxAttempts;
  }

  async settle(
    usedDelta: number,
    succeeded: boolean,
    error: unknown,
  ): Promise<void> {
    this.recoveryConsumption +=
      usedDelta + (this.options === undefined ? 1 : 0);
    if (!succeeded) await this.releaseUnsent(error);
  }

  async prepare(
    provider: IProvider,
    options: GenerateChatOptions,
    signal: AbortSignal,
  ): Promise<GenerateChatOptions> {
    this.options = undefined;
    this.unsentRelease = undefined;
    this.attempt += 1;
    // #3444: the first attempt sends the options exactly as received;
    // every retry replaces the spent prompt-envelope transport token
    // with a freshly projected one before linking the attempt signal.
    const sendOptions =
      this.attempt === 1
        ? { options, releaseIfUnsent: undefined }
        : await refreshPromptEnvelopeForRetry(provider, options);
    this.unsentRelease = sendOptions.releaseIfUnsent;
    if (signal.aborted) throw createAbortError(signal.reason);
    this.options = withRequestSignal(sendOptions.options, signal);
    return this.options;
  }

  async releaseUnsent(attemptError: unknown): Promise<void> {
    const release = this.unsentRelease;
    this.unsentRelease = undefined;
    if (release === undefined) return;
    try {
      await release();
    } catch (cleanupError) {
      if (attemptError === undefined) throw cleanupError;
      new DebugLogger('llxprt:retry:orchestrator').debug(
        () =>
          `Releasing unsent prompt envelope failed: ${String(cleanupError)}`,
      );
    }
  }
}
