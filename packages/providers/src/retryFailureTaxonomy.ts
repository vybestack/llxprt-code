/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isTimeoutError } from './loadBalancing/streamTimeout.js';
import { isStreamTimeoutError } from './providerErrorObservation.js';
import {
  isMalformedStreamEventError,
  isStreamTruncatedError,
} from './streamProtocolErrors.js';
import {
  MAX_RETRY_AFTER_MS,
  getRetryAfterDelayMs,
} from './retryAfterHeader.js';
import { isQuotaExhaustionError } from './utils/quotaExhaustion.js';
import {
  classifyRetryError,
  type RetryErrorClassification,
} from './retryErrorClassification.js';

/** The stage of a provider request at which a failure occurred. */
export type RetryFailurePhase =
  | 'connect'
  | 'headers'
  | 'stream'
  | 'protocol'
  | 'auth'
  | 'tool'
  | 'cancellation';

/** A provider-independent failure category used by recovery policy. */
export type RetryFailureKind =
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'overload'
  | 'server'
  | 'auth'
  | 'payment'
  | 'malformed'
  | 'truncated'
  | 'invalid_request'
  | 'cancelled'
  | 'unknown';

/** The strongest kind of streamed output exposed to a caller. */
export type StreamExposure = 'none' | 'metadata' | 'content' | 'tool_call';

/** A provider failure normalized for shared retry and failover policy. */
export interface RetryFailure {
  readonly phase: RetryFailurePhase;
  readonly kind: RetryFailureKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly providerCode?: string;
  readonly cause: unknown;
}

/** Failure kinds that remain eligible for recovery before request commitment. */
export const RETRYABLE_FAILURE_KINDS: ReadonlySet<RetryFailureKind> = new Set([
  'timeout',
  'network',
  'rate_limit',
  'overload',
  'server',
  'auth',
  'malformed',
  'truncated',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordProperty(
  value: unknown,
  property: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  // Property access on arbitrary provider errors must never throw
  // (throwing getters/proxies degrade to "absent", matching hasErrorName).
  let propertyValue: unknown;
  try {
    propertyValue = value[property];
  } catch {
    return undefined;
  }
  return isRecord(propertyValue) ? propertyValue : undefined;
}

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (!isRecord(value)) return undefined;
  let propertyValue: unknown;
  try {
    propertyValue = value[property];
  } catch {
    return undefined;
  }
  return typeof propertyValue === 'string' ? propertyValue : undefined;
}

/**
 * Reads the provider's own error code from every position production errors
 * use: the Anthropic nested envelope (`error.error.type`), the OpenAI
 * envelope (`error.code`), the Codex/ChatGPT `detail` envelope, and the
 * `providerErrorType` field that parseErrorResponse lifts onto thrown
 * errors. Mirrors the positions recognized by quota classification.
 *
 * The error's own top-level `code` property is deliberately NOT read: Node
 * transport errors store errno identifiers there (ECONNRESET, ETIMEDOUT,
 * UND_ERR_SOCKET) which would pollute telemetry as fake provider codes.
 */
function getProviderCode(error: unknown): string | undefined {
  const envelope = readRecordProperty(error, 'error');
  const detail = readRecordProperty(envelope, 'error');
  const openAiDetail = readRecordProperty(error, 'detail');
  const positions: Array<[unknown, string]> = [
    [detail, 'type'],
    [envelope, 'type'],
    [error, 'type'],
    [error, 'providerErrorType'],
    [envelope, 'code'],
    [openAiDetail, 'code'],
    [openAiDetail, 'type'],
  ];
  for (const [holder, property] of positions) {
    const code = readStringProperty(holder, property);
    if (code !== undefined && code !== 'error') return code;
  }
  return undefined;
}

function hasErrorName(error: unknown, expected: string): boolean {
  if (!isRecord(error)) return false;
  try {
    return error.name === expected;
  } catch {
    return false;
  }
}

function getCappedRetryAfterMs(error: unknown): number | undefined {
  const retryAfterMs = getRetryAfterDelayMs(error);
  return retryAfterMs === undefined
    ? undefined
    : Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
}

interface FailureIdentity {
  readonly phase: RetryFailurePhase;
  readonly kind: RetryFailureKind;
}

function getStatusIdentity(
  status: number | undefined,
): FailureIdentity | undefined {
  if (status === 401 || status === 403) {
    return { phase: 'auth', kind: 'auth' };
  }
  if (status === 402) return { phase: 'auth', kind: 'payment' };
  if (status === 429) return { phase: 'headers', kind: 'rate_limit' };
  if (status !== undefined && status >= 500 && status < 600) {
    return { phase: 'headers', kind: 'server' };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { phase: 'headers', kind: 'invalid_request' };
  }
  return undefined;
}

function getProviderIdentity(
  providerCode: string | undefined,
): FailureIdentity | undefined {
  if (providerCode === 'overloaded_error') {
    return { phase: 'stream', kind: 'overload' };
  }
  if (providerCode === 'rate_limit_error') {
    return { phase: 'stream', kind: 'rate_limit' };
  }
  if (providerCode === 'api_error') {
    return { phase: 'stream', kind: 'server' };
  }
  return undefined;
}

function getClassificationIdentity(
  classification: RetryErrorClassification,
): FailureIdentity | undefined {
  if (classification.isNetworkError || classification.category === 'network') {
    return { phase: 'connect', kind: 'network' };
  }
  if (classification.category === 'rate_limit') {
    return { phase: 'headers', kind: 'rate_limit' };
  }
  if (classification.category === 'server_error') {
    return { phase: 'headers', kind: 'server' };
  }
  if (classification.category === 'authentication') {
    return { phase: 'auth', kind: 'auth' };
  }
  if (classification.category === 'quota') {
    return { phase: 'auth', kind: 'payment' };
  }
  if (classification.category === 'client_error') {
    return { phase: 'headers', kind: 'invalid_request' };
  }
  return undefined;
}

function resolveFailureIdentity(
  error: unknown,
  classification: RetryErrorClassification,
  providerCode: string | undefined,
): FailureIdentity {
  if (hasErrorName(error, 'AbortError')) {
    return { phase: 'cancellation', kind: 'cancelled' };
  }
  if (isTimeoutError(error) || isStreamTimeoutError(error)) {
    return { phase: 'stream', kind: 'timeout' };
  }
  if (isStreamTruncatedError(error)) {
    return { phase: 'stream', kind: 'truncated' };
  }
  if (isMalformedStreamEventError(error)) {
    return { phase: 'protocol', kind: 'malformed' };
  }
  // Terminal status bands outrank provider body codes: a 403 whose body
  // says api_error must stay terminal auth (issue #2917 regression guard)
  // and a 404 carrying rate_limit_error stays terminal invalid_request
  // (issue #3140). Transient statuses (429, 5xx/529) defer to the more
  // specific provider code first.
  const statusIdentity = getStatusIdentity(classification.status);
  if (
    statusIdentity !== undefined &&
    statusIdentity.kind !== 'rate_limit' &&
    statusIdentity.kind !== 'server'
  ) {
    return statusIdentity;
  }
  return (
    getProviderIdentity(providerCode) ??
    statusIdentity ??
    getClassificationIdentity(classification) ?? {
      phase: 'protocol',
      kind: 'unknown',
    }
  );
}

function buildRetryFailure(
  error: unknown,
  identity: FailureIdentity,
  status: number | undefined,
  providerCode: string | undefined,
): RetryFailure {
  const retryAfterMs = getCappedRetryAfterMs(error);
  return {
    ...identity,
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    cause: error,
  };
}

/**
 * Decodes an arbitrary provider error into the shared retry taxonomy.
 *
 * @param error Error thrown by a provider or stream wrapper.
 * @returns A normalized failure retaining the original value as its cause.
 */
export function decodeRetryFailure(error: unknown): RetryFailure {
  // Decoding must be total: a hostile getter on an arbitrary error object
  // (classification reads, provider-code probes, identity resolution, or the
  // Retry-After header walk) degrades to an unknown failure instead of
  // propagating outward and masking the real error.
  try {
    const classification = classifyRetryError(error);
    const providerCode = getProviderCode(error);
    const identity = resolveFailureIdentity(
      error,
      classification,
      providerCode,
    );
    return buildRetryFailure(
      error,
      identity,
      classification.status,
      providerCode,
    );
  } catch {
    return { phase: 'protocol', kind: 'unknown', cause: error };
  }
}

/**
 * Reports whether a failure kind is eligible for pre-commit recovery.
 *
 * Kind-level eligibility ignores status and provider codes; recovery
 * decisions must use {@link isRetryableFailure}, which consumes the full
 * failure. Retained for callers that only need the coarse kind gate.
 *
 * @param kind Normalized failure kind.
 * @returns True when the kind can be retried before output is exposed.
 */
export function isRetryableFailureKind(kind: RetryFailureKind): boolean {
  return RETRYABLE_FAILURE_KINDS.has(kind);
}

interface AggregateRetryability {
  failures?: unknown;
  isRetryable?: unknown;
}

function readAggregateRetryability(failure: RetryFailure): boolean | undefined {
  const cause = failure.cause;
  if (typeof cause !== 'object' || cause === null) return undefined;
  const aggregate = cause as AggregateRetryability;
  if (!Array.isArray(aggregate.failures)) return undefined;
  if (typeof aggregate.isRetryable !== 'boolean') return undefined;
  return aggregate.isRetryable;
}

/**
 * The single recovery-eligibility decision for a normalized failure.
 *
 * Consumes the full failure — kind, status, and cause shape — so status
 * and provider-code exceptions (403 auth, terminal-quota 429,
 * load-balancer-owned request timeouts) resolve here instead of in every
 * caller. This is what `shouldRetryError` delegates to; recovery layers
 * must call it rather than re-deriving eligibility from the kind alone.
 *
 * @param failure Normalized provider failure.
 * @returns True when the failure may be retried before output is exposed.
 */
export function isRetryableFailure(failure: RetryFailure): boolean {
  const aggregate = readAggregateRetryability(failure);
  if (aggregate !== undefined) return aggregate;
  switch (failure.kind) {
    case 'network':
    case 'overload':
    case 'server':
    case 'malformed':
    case 'truncated':
      return true;
    case 'rate_limit':
      return !isQuotaExhaustionError(failure.cause);
    case 'auth':
      return failure.status === 401;
    case 'timeout':
      // Load-balancer request timeouts are governed by the load balancer's
      // own failover settings; only orchestrator first-chunk stream
      // timeouts are retried by the central policy.
      return isStreamTimeoutError(failure.cause);
    default:
      return false;
  }
}

/**
 * Narrows a normalized failure to a timeout failure.
 *
 * @param failure Normalized provider failure.
 * @returns True when the failure represents a timeout.
 */
export function isTimeoutFailure(
  failure: RetryFailure,
): failure is RetryFailure & { readonly kind: 'timeout' } {
  return failure.kind === 'timeout';
}
