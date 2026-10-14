/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { tryConsumeTransportAttempt } from '../transportAttemptBudget.js';
import { acquireRequestScopedBody } from '../utils/requestScopedBody.js';
import type { AnthropicApiCall } from './AnthropicApiExecution.js';
import {
  sendRequestFromBody,
  type AnthropicSendRequest,
} from './AnthropicSendRequest.js';
import {
  isAnthropicImageDimensionLimitError,
  parseAnthropicImageDimensionLimit,
  sanitizeAnthropicRequestBodyImages,
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
}

/**
 * Issue #3216: one-shot recovery from a 400 that specifically states an image
 * dimension exceeded the many-image maximum. Sanitizes oversized base64 image
 * blocks from an immutable copy of the request body and retries exactly once.
 * Returns the retry result, or `undefined` when the error is not recoverable
 * (unrelated 400, no parseable limit, no oversized blocks to remove, the
 * request-scoped recovery was already used, or no transport attempt remains)
 * so the caller rethrows the original error. Never loops.
 *
 * H2: the recovery is request-scoped — at most one recovery per logical
 * request shared across outer RetryOrchestrator attempts — and the retry's
 * physical transport call consumes a slot from the shared transport budget
 * so outer attempt accounting stays exact. The sanitized body is stored in
 * the shared request state so subsequent outer attempts reuse it instead of
 * reconstructing and resending the poisoned original.
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
  mediaRequest: ResolvedMediaRequest,
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
  // The recovery retry sends a sanitized copy of the whole body, so the body
  // is read back as an object here, on this error path only.
  const sanitized = sanitizeAnthropicRequestBodyImages(
    await request.body(),
    recoveryBudget,
  );
  if (sanitized.replacedCount === 0) return undefined;
  // A known-aborted request must not consume a transport slot on a recovery
  // that can never produce a usable response. Check before accounting.
  if (options.invocation.signal?.aborted === true) return undefined;
  // H2: the retry is a physical transport call; account it in the shared
  // budget. When no slot remains, the original error is final.
  if (!tryConsumeTransportAttempt(options)) return undefined;
  state.recoveryUsed = true;
  state.sanitizedBody = sanitized.body;
  const recoveryBodyLease = acquireRequestScopedBody(
    'anthropic',
    sanitized.body,
  );
  mediaRequest.registerCleanup(() => {
    void recoveryBodyLease.release();
  });
  deps.errorsLogger.debug(
    () =>
      '[AnthropicProvider] Image dimension 400: sanitized oversized image block(s), retrying once',
  );
  const retryRequest = sendRequestFromBody(request.facts, sanitized.body);
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
