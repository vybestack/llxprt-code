/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { tryConsumeTransportAttempt } from '../transportAttemptBudget.js';
import type { AnthropicApiCall } from './AnthropicApiExecution.js';
import {
  sendRequestFromSpool,
  type AnthropicSendRequest,
} from './AnthropicSendRequest.js';
import type { SpooledAnthropicRequest } from './AnthropicSpooledRequest.js';
import {
  isAnthropicImageDimensionLimitError,
  parseAnthropicImageDimensionLimit,
  resolveAnthropicImageBudget,
  resolveRecoveryImageBudget,
  ensureImageRecoveryState,
} from './AnthropicImageSanitizer.js';
import type { AnthropicRateLimitInfo } from './AnthropicRateLimitHandler.js';

type ExecutedAnthropicCall = {
  response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
  rateLimitInfo?: AnthropicRateLimitInfo | undefined;
};

/** The provider's transport call and error logger the recovery runs through. */
export interface ImageRecoveryDeps {
  readonly execute: (
    options: NormalizedGenerateChatOptions,
    request: AnthropicSendRequest,
    apiCallWithResponse: AnthropicApiCall,
    rateLimitLogger: { debug: (fn: () => string) => void },
    headers: Record<string, string>,
    isOAuth: boolean,
    authToken: string,
  ) => Promise<ExecutedAnthropicCall>;
  readonly errorsLogger: { debug: (fn: () => string) => void };
  /**
   * Builds the request again from the rows with `budget` applied to the
   * finished images. The request owns its spool and releases it with the
   * media request that was given to it.
   */
  readonly rebuild: (
    budget: ImageDimensionBudget,
  ) => Promise<SpooledAnthropicRequest>;
}

function isAborted(options: NormalizedGenerateChatOptions): boolean {
  return options.invocation.signal?.aborted === true;
}

/**
 * Issue #3216: one-shot recovery from a 400 that specifically states an image
 * dimension exceeded the many-image maximum. Builds the request again from
 * the rows with oversized images replaced and retries exactly once.
 * Returns the retry result, or `undefined` when the error is not recoverable
 * (unrelated 400, no parseable limit, no oversized images to replace, the
 * request-scoped recovery was already used, or no transport attempt remains)
 * so the caller rethrows the original error. Never loops.
 *
 * H2: the recovery is request-scoped, at most one recovery per logical
 * request shared across outer RetryOrchestrator attempts, and the retry's
 * physical transport call consumes a slot from the shared transport budget
 * so outer attempt accounting stays exact. What the shared request state
 * keeps is the budget (a number or two): a later outer attempt builds its
 * request under it, so the poisoned original is not resent and no body, array
 * or copy of one is held between attempts.
 */
export async function executeImageDimensionRecovery(
  deps: ImageRecoveryDeps,
  error: unknown,
  request: AnthropicSendRequest,
  options: NormalizedGenerateChatOptions,
  initialClient: Anthropic,
  customHeaders: Record<string, string>,
  rateLimitLogger: { debug: (fn: () => string) => void },
  isOAuth: boolean,
  authToken: string,
): Promise<
  | {
      response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
      rateLimitInfo: AnthropicRateLimitInfo | undefined;
    }
  | undefined
> {
  if (!isAnthropicImageDimensionLimitError(error)) return undefined;
  const state = ensureImageRecoveryState(options);
  if (state.recoveryUsed) return undefined;
  const configuredBudget = resolveAnthropicImageBudget(
    request.facts.configEphemerals,
  );
  const errorLimit = parseAnthropicImageDimensionLimit(error);
  const recoveryBudget = resolveRecoveryImageBudget(
    configuredBudget,
    errorLimit,
  );
  if (recoveryBudget === undefined) return undefined;
  // A known-aborted request must not build a retry or consume a transport
  // slot on a recovery that can never produce a usable response.
  if (isAborted(options)) return undefined;
  const retry = await deps.rebuild(recoveryBudget);
  if (retry.recoveredImages === 0) {
    retry.release();
    return undefined;
  }
  // H2: the retry is a physical transport call; account it in the shared
  // budget. When no slot remains, the original error is final.
  if (isAborted(options) || !tryConsumeTransportAttempt(options)) {
    retry.release();
    return undefined;
  }
  state.recoveryUsed = true;
  state.recoveryBudget = recoveryBudget;
  deps.errorsLogger.debug(
    () =>
      '[AnthropicProvider] Image dimension 400: replaced oversized image block(s), retrying once',
  );
  const retryRequest = sendRequestFromSpool(retry);
  const retryResult = await deps.execute(
    options,
    retryRequest,
    retryRequest.call(initialClient, customHeaders, options.invocation.signal),
    rateLimitLogger,
    customHeaders,
    isOAuth,
    authToken,
  );
  return {
    response: retryResult.response,
    rateLimitInfo: retryResult.rateLimitInfo,
  };
}
