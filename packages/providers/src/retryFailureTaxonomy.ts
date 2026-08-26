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
import { getDelayDuration, getRetryAfterDelayMs } from './retryDelayPolicy.js';
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
  const propertyValue = value[property];
  return isRecord(propertyValue) ? propertyValue : undefined;
}

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (!isRecord(value)) return undefined;
  const propertyValue = value[property];
  return typeof propertyValue === 'string' ? propertyValue : undefined;
}

function getProviderCode(error: unknown): string | undefined {
  const envelope = readRecordProperty(error, 'error');
  const detail = readRecordProperty(envelope, 'error');
  const code =
    readStringProperty(detail, 'type') ??
    readStringProperty(envelope, 'type') ??
    readStringProperty(error, 'type');
  return code === 'error' ? undefined : code;
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
  if (getRetryAfterDelayMs(error) <= 0) return undefined;
  return getDelayDuration(error, 0);
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
  return (
    getStatusIdentity(classification.status) ??
    getProviderIdentity(providerCode) ??
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
  const classification = classifyRetryError(error);
  const providerCode = getProviderCode(error);
  const identity = resolveFailureIdentity(error, classification, providerCode);
  return buildRetryFailure(
    error,
    identity,
    classification.status,
    providerCode,
  );
}

/**
 * Reports whether a failure kind is eligible for pre-commit recovery.
 *
 * @param kind Normalized failure kind.
 * @returns True when the kind can be retried before output is exposed.
 */
export function isRetryableFailureKind(kind: RetryFailureKind): boolean {
  return RETRYABLE_FAILURE_KINDS.has(kind);
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
