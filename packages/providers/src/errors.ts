/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import {
  getErrorStatus,
  isRetryableError,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import type { StructuredErrorCategory } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  classifyProviderError,
  formatPublicProviderMessage,
  getEffectiveProviderStatus,
  getSafeProviderMessage,
  summarizeProviderLabels,
} from './providerErrorObservation.js';

/**
 * Error thrown when authentication is required but not available
 */
export class AuthenticationRequiredError extends Error {
  readonly authMode: string;
  readonly requiredAuth?: string[];

  constructor(message: string, authMode: string, requiredAuth?: string[]) {
    super(message);
    this.name = 'AuthenticationRequiredError';
    this.authMode = authMode;
    this.requiredAuth = requiredAuth;
  }
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P03
 * @requirement:REQ-SP4-001
 * @pseudocode base-provider-runtime-guard.md lines 10-14
 */
export class MissingProviderRuntimeError extends Error {
  /**
   * Call-site provider identifier (e.g. `BaseProvider.openai`).
   */
  readonly providerKey: string;
  /**
   * Required runtime properties that were not supplied.
   */
  readonly missingFields: readonly string[];
  /**
   * Requirement tag to aid verification harnesses.
   */
  readonly requirement: string;
  /**
   * Recommendations for callers to remediate the guard failure.
   */
  readonly remediation: readonly string[];
  /**
   * Structured metadata attached to the error for diagnostics.
   */
  readonly context: {
    stage?: string;
    metadata?: Record<string, unknown>;
  };

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode base-provider-fallback-removal.md lines 11-12
   */
  constructor({
    providerKey,
    missingFields,
    requirement = 'REQ-SP4-001',
    remediation,
    stage,
    metadata,
    message,
  }: {
    providerKey: string;
    missingFields: string[];
    requirement?: string;
    remediation?: string[];
    stage?: string;
    metadata?: Record<string, unknown>;
    message?: string;
  }) {
    const formattedMissing =
      missingFields.length > 0 ? missingFields.join(', ') : 'runtime data';
    super(
      message ??
        `Provider ${providerKey} invoked without required runtime context (${formattedMissing}).`,
    );
    this.name = 'MissingProviderRuntimeError';
    this.providerKey = providerKey;
    this.missingFields = missingFields;
    this.requirement = requirement;
    this.remediation = remediation ?? [
      'Ensure ProviderManager injects settings/config before invoking providers.',
      'Verify CLI runtime wiring activates an isolated ProviderRuntimeContext per call.',
    ];
    this.context = {
      stage,
      metadata,
    };
  }
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-002
 * @pseudocode provider-runtime-handling.md lines 11-12
 */
export class ProviderRuntimeNormalizationError extends Error {
  readonly providerKey: string;
  readonly requirement: string;
  readonly context: {
    runtimeId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  };

  constructor({
    providerKey,
    message,
    requirement = 'REQ-SP4-002',
    runtimeId,
    stage,
    metadata,
  }: {
    providerKey: string;
    message: string;
    requirement?: string;
    runtimeId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  }) {
    super(message);
    this.name = 'ProviderRuntimeNormalizationError';
    this.providerKey = providerKey;
    this.requirement = requirement;
    this.context = {
      runtimeId,
      stage,
      metadata,
    };
  }
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-004
 * @pseudocode logging-wrapper-adjustments.md lines 11, 15
 */
export class ProviderRuntimeScopeError extends Error {
  readonly requirement: string;
  readonly context: {
    callId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  };

  constructor({
    message,
    requirement = 'REQ-SP4-004',
    callId,
    stage,
    metadata,
  }: {
    message: string;
    requirement?: string;
    callId?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
  }) {
    super(message);
    this.name = 'ProviderRuntimeScopeError';
    this.requirement = requirement;
    this.context = {
      callId,
      stage,
      metadata,
    };
  }
}

/**
 * Error thrown when all backends in a load balancer failover policy have failed
 * @plan PLAN-20251212issue488
 */
export type BucketFailoverPolicy = 'eligible' | 'ineligible';

export interface BucketFailoverPolicyError {
  readonly bucketFailoverPolicy: BucketFailoverPolicy;
}

export function permitsBucketFailover(error: unknown): boolean {
  return !(
    typeof error === 'object' &&
    error !== null &&
    'bucketFailoverPolicy' in error &&
    error.bucketFailoverPolicy === 'ineligible'
  );
}

export class LoadBalancerFailoverError extends Error {
  readonly profileName: string;
  readonly failures: ReadonlyArray<{
    readonly profile: string;
    readonly error: Error;
  }>;
  readonly isRetryable: boolean;
  readonly bucketFailoverPolicy = 'ineligible' as const;
  readonly status?: number;
  readonly category?: StructuredErrorCategory;
  readonly reason = 'retries_exhausted' as const;

  constructor(
    profileName: string,
    failures: Array<{ profile: string; error: Error }>,
  ) {
    const categories = failures.map(({ error }) =>
      classifyProviderError(error, getErrorStatus(error)),
    );
    const statuses = failures.map(({ error }, index) =>
      getEffectiveProviderStatus(
        error,
        getErrorStatus(error),
        categories[index],
      ),
    );
    const category = getHomogeneousValue(categories);
    const status = getHomogeneousValue(statuses);
    const safeProfileName = summarizeProviderLabels([profileName]);
    const safeFailureProfiles = summarizeProviderLabels(
      failures.map(({ profile }) => profile),
    );
    const failureSummary = summarizeFailures(failures);
    super(
      formatPublicProviderMessage(
        `Load balancer "${safeProfileName}" failover exhausted after ${failures.length} backend failures (tried: ${safeFailureProfiles})`,
        failureSummary,
      ),
      { cause: failures[failures.length - 1]?.error },
    );
    this.name = 'LoadBalancerFailoverError';
    this.profileName = profileName;
    this.failures = failures;
    this.isRetryable = computeAggregateRetryable(failures);
    this.status = status;
    this.category = category;
  }
}

/**
 * Determine whether a single backend failure is transient/retryable for the
 * purpose of LB-level aggregate classification. (issue #2450)
 *
 * Delegates to core's `isRetryableError` for all transient categories
 * (network-transient, RetryableQuotaError, overload, 429, 5xx), then
 * explicitly overrides 401/403 to NON-retryable because they indicate
 * auth/config problems, not transient load. This avoids hand-syncing a
 * duplicate precedence list — any new transient category added to
 * `isRetryableError` is automatically honored here.
 *
 * Safe against recursion: this is called only on individual backend errors
 * (`failures[].error`), never on a `LoadBalancerFailoverError` aggregate.
 */
function isTransientBackendFailure(error: Error): boolean {
  if (!isRetryableError(error)) {
    return false;
  }
  // Override: 401/403 are auth/config problems, not transient load.
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) {
    return false;
  }
  return true;
}

function computeAggregateRetryable(
  failures: ReadonlyArray<{ readonly error: Error }>,
): boolean {
  if (failures.length === 0) {
    return false;
  }
  return failures.every((f) => isTransientBackendFailure(f.error));
}

function getHomogeneousValue<T>(
  values: ReadonlyArray<T | undefined>,
): T | undefined {
  const first = values[0];
  if (first === undefined || !values.every((value) => value === first)) {
    return undefined;
  }
  return first;
}

/**
 * Build a human-readable summary of per-backend failures. For a single failure
 * the underlying message is used; for multiple failures each backend name,
 * message, and HTTP status (when available) are included so callers can diagnose
 * auth, rate-limit, and server issues without inspecting structured fields.
 */
const MAX_DISPLAYED_FAILURES = 3;

function summarizeFailures(
  failures: Array<{ profile: string; error: Error }>,
): string {
  if (failures.length === 0) return 'no backend attempts were recorded';
  const displayed = failures
    .slice(0, MAX_DISPLAYED_FAILURES)
    .map(({ profile, error }) => {
      const status = getErrorStatus(error);
      const statusSuffix = status !== undefined ? ` (status: ${status})` : '';
      return `${summarizeProviderLabels([profile])}: ${getSafeProviderMessage(error)}${statusSuffix}`;
    });
  const omitted = failures.length - displayed.length;
  return `${displayed.join('; ')}${omitted > 0 ? `; +${omitted} more` : ''}`;
}

/**
 * @plan PLAN-20260128issue808
 * Standardized provider error hierarchy for RetryOrchestrator
 *
 * Base class for all provider errors with consistent retry/failover behavior
 */
export abstract class ProviderError extends Error {
  abstract readonly category: StructuredErrorCategory;
  abstract readonly isRetryable: boolean;
  abstract readonly shouldFailover: boolean;
  readonly status?: number;
  readonly retryAfter?: number;
  override readonly cause?: Error;
  constructor(
    message: string,
    options?: { status?: number; retryAfter?: number; cause?: Error },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = options?.status;
    this.retryAfter = options?.retryAfter;
    this.cause = options?.cause;
  }
}

/**
 * Error for rate limit (429) responses
 * Retryable with exponential backoff, triggers bucket failover
 */
export class RateLimitError extends ProviderError {
  readonly category = 'rate_limit' as const;
  readonly isRetryable = true;
  readonly shouldFailover = true;
}

export class StreamCleanupTimeoutError extends ProviderError {
  readonly category = 'server_error' as const;
  readonly isRetryable = false;
  readonly shouldFailover = false;
  readonly failures: readonly Error[];

  constructor(cause: Error) {
    super('Provider stream did not stop after cancellation', { cause });
    this.failures = [cause];
  }
}

export class RetriesExhaustedError extends ProviderError {
  readonly isRetryable = false;
  readonly shouldFailover = false;
  readonly bucketFailoverPolicy = 'ineligible' as const;
  readonly reason = 'retries_exhausted' as const;
  readonly failures: readonly Error[];

  constructor(
    message: string,
    readonly category: StructuredErrorCategory,
    options: { status?: number; cause: Error },
  ) {
    super(message, options);
    this.failures = [options.cause];
  }
}

/**
 * Error for quota exceeded (402 payment required)
 * Triggers immediate bucket failover
 */
export class QuotaError extends ProviderError {
  readonly category = 'quota' as const;
  readonly isRetryable = true;
  readonly shouldFailover = true; // Instant bucket failover
}

/**
 * Error for authentication failures (401/403)
 * Retryable once to allow token refresh, then triggers bucket failover
 */
export class AuthenticationError extends ProviderError {
  readonly category = 'authentication' as const;
  readonly isRetryable = true; // Allow one retry for token refresh
  readonly shouldFailover = true;
}

/**
 * Error for server errors (5xx)
 * Retryable with exponential backoff, does not trigger bucket failover
 */
export class ServerError extends ProviderError {
  readonly category = 'server_error' as const;
  readonly isRetryable = true;
  readonly shouldFailover = false;
}

/**
 * Error for network/transient errors (ECONNRESET, etc.)
 * Retryable with exponential backoff, does not trigger bucket failover
 */
export class NetworkError extends ProviderError {
  readonly category = 'network' as const;
  readonly isRetryable = true;
  readonly shouldFailover = false;
}

/**
 * Error for client errors (400, 404, etc.)
 * Not retryable, does not trigger bucket failover
 */
export class ClientError extends ProviderError {
  readonly category = 'client_error' as const;
  readonly isRetryable = false;
  readonly shouldFailover = false;
}

/**
 * @plan PLAN-20260223-ISSUE1598.P03
 * @requirement REQ-1598-IC08
 * @pseudocode error-reporting.md lines 3-8
 */
export type BucketFailureReason =
  | 'quota-exhausted'
  | 'expired-refresh-failed'
  | 'reauth-failed'
  | 'reauth-timeout'
  | 'no-token'
  | 'skipped';

const AUTH_BUCKET_FAILURE_REASONS: ReadonlySet<BucketFailureReason> = new Set([
  'expired-refresh-failed',
  'reauth-failed',
  'reauth-timeout',
]);

/**
 * Returns whether a bucket failure reason requires user re-authentication.
 * AUTH_BUCKET_FAILURE_REASONS is the canonical set for UI and display decisions.
 */
export function isAuthBucketFailureReason(
  reason: BucketFailureReason,
): boolean {
  return AUTH_BUCKET_FAILURE_REASONS.has(reason);
}

/**
 * Thrown when all OAuth buckets are exhausted during failover
 * @plan PLAN-20260128issue808
 * @plan PLAN-20260223-ISSUE1598.P06
 * @requirement REQ-1598-ER01, REQ-1598-ER02, REQ-1598-ER03
 * @pseudocode error-reporting.md lines 10-40
 */
export class AllBucketsExhaustedError extends Error {
  readonly attemptedBuckets: string[];
  readonly lastError: Error;
  readonly bucketFailureReasons: Record<string, BucketFailureReason>;
  readonly status?: number;
  readonly category: StructuredErrorCategory;
  readonly reason = 'all_buckets_exhausted' as const;
  readonly isRetryable = false;
  readonly failures: readonly Error[];

  constructor(
    providerName: string,
    attemptedBuckets: string[],
    lastError: Error,
    bucketFailureReasons?: Record<string, BucketFailureReason>,
  ) {
    const storedReasons: Record<string, BucketFailureReason> =
      bucketFailureReasons ? { ...bucketFailureReasons } : {};
    const reasons: Partial<Record<string, BucketFailureReason>> = storedReasons;
    // Build enhanced message with per-bucket reasons only when provided
    let bucketDetails = '';
    if (bucketFailureReasons) {
      bucketDetails = attemptedBuckets
        .map((b) => {
          const reason = reasons[b];
          return `  - ${b}: ${reason ?? 'unknown'}`;
        })
        .join('\n');
    }

    // Extract human-readable message from Anthropic-style JSON error strings
    const cleanedLastErrorMsg =
      AllBucketsExhaustedError.extractHumanReadableMessage(lastError.message);

    const hasAuthReason = Object.values(storedReasons).some((r) =>
      isAuthBucketFailureReason(r),
    );
    const reauthenticateSuffix = hasAuthReason
      ? '\nPlease re-authenticate to continue. The auth dialog will open on your next message.'
      : '';

    super(
      formatPublicProviderMessage(
        `All buckets exhausted for provider '${summarizeProviderLabels([providerName])}' after ${attemptedBuckets.length} attempts (buckets: ${summarizeProviderLabels(attemptedBuckets)})`,
        `${bucketDetails} Last error: ${cleanedLastErrorMsg}${reauthenticateSuffix}`,
      ),
      { cause: lastError },
    );
    this.name = 'AllBucketsExhaustedError';
    this.attemptedBuckets = [...attemptedBuckets];
    this.lastError = lastError;
    this.bucketFailureReasons = storedReasons;
    const rawStatus = getErrorStatus(lastError);
    this.category =
      classifyProviderError(lastError, rawStatus) ?? 'client_error';
    this.status = getEffectiveProviderStatus(
      lastError,
      rawStatus,
      this.category,
    );
    this.failures = [lastError];
  }

  /**
   * Extracts the human-readable message from Anthropic-style JSON error strings.
   * e.g. '429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}'
   *      → 'Rate limited'
   */
  private static extractHumanReadableMessage(raw: string): string {
    return getSafeProviderMessage(raw);
  }
}
