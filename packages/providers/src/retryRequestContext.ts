/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';
import { attachProviderErrorObservationContext } from './providerErrorObservation.js';
import type { StreamExposure } from './retryFailureTaxonomy.js';
import {
  attachTransportAttemptBudget,
  RETRY_REQUEST_CONTEXT_KEY,
  type TransportAttemptBudget,
} from './transportAttemptBudget.js';

export interface RetryRequestContext {
  readonly options: GenerateChatOptions;
  readonly budget: TransportAttemptBudget;
  readonly releaseBudget: () => void;
  readonly markCommitted: (exposure: StreamExposure) => void;
  readonly markTerminalSeen: () => void;
  readonly committed: boolean;
  readonly exposure: StreamExposure;
  readonly terminalSeen: boolean;
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly authRetryTimeoutMs: number;
  /** Records recovery wait time (ms) against the request budget. */
  readonly recordWait: (waitMs: number) => void;
  /** Records a recovery target (provider or backend) visited by the request. */
  readonly recordTarget: (target: string) => void;
  /** Records an opaque credential id used by an attempt (never the secret). */
  readonly recordCredentialId: (credentialId: string) => void;
  readonly totalWaitMs: number;
  readonly visitedTargets: readonly string[];
  readonly visitedCredentialCount: number;
  /** Remaining ms before the optional request deadline, or undefined. */
  readonly deadlineRemainingMs: number | undefined;
}

interface MutableRequestCommitState {
  committed: boolean;
  exposure: StreamExposure;
  terminalSeen: boolean;
}

/**
 * Request-scoped recovery accounting (issue #2532): cumulative backoff wait,
 * optional wall-clock deadline, and the targets/credentials each request
 * visited. Stored on the shared metadata record next to the commit state so
 * every recovery layer observes one budget.
 */
interface MutableRecoveryTracking {
  totalWaitMs: number;
  startedAtMs: number;
  deadlineAtMs: number | undefined;
  visitedTargets: Set<string>;
  visitedCredentialIds: Set<string>;
}

const RETRY_REQUEST_CONTEXT_KEYS = {
  recoveryTracking: 'recoveryTracking',
} as const;

const RETRY_EPHEMERAL_KEYS = {
  maxAttempts: 'retries',
  initialDelayMs: 'retrywait',
  authRetryTimeoutMs: 'auth-retry-timeout',
  deadlineMs: 'retry-deadline-ms',
} as const;

const EXPOSURE_STRENGTH: Readonly<Record<StreamExposure, number>> = {
  none: 0,
  metadata: 1,
  content: 2,
  tool_call: 3,
};

const requestCommitStates = new WeakMap<
  RetryRequestContext,
  MutableRequestCommitState
>();

/**
 * Structural seam through which any wrapper layer (guarded stream, load
 * balancer backend attempt, provider stream processor) reads or updates the
 * request's shared commit state. A RetryRequestContext satisfies this
 * interface; an options-only caller can obtain a handle via
 * findRequestCommitState.
 */
export interface RequestCommitState {
  markCommitted(exposure: StreamExposure): void;
  markTerminalSeen(): void;
}

function positiveInteger(value: unknown, fallback: number): number {
  const defaultValue =
    Number.isFinite(fallback) && fallback > 0
      ? Math.max(1, Math.floor(fallback))
      : 1;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : defaultValue;
}

function nonNegativeFiniteNumber(value: unknown, fallback: number): number {
  const defaultValue =
    Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : defaultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStreamExposure(value: unknown): value is StreamExposure {
  return (
    value === 'none' ||
    value === 'metadata' ||
    value === 'content' ||
    value === 'tool_call'
  );
}

function isMutableRequestCommitState(
  value: unknown,
): value is Record<string, unknown> & MutableRequestCommitState {
  return (
    isRecord(value) &&
    typeof value.committed === 'boolean' &&
    isStreamExposure(value.exposure) &&
    typeof value.terminalSeen === 'boolean'
  );
}

function getRequestMetadataContext(
  options: GenerateChatOptions,
): Record<string, unknown> {
  const context = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  if (!isRecord(context)) {
    throw new TypeError('Retry request metadata context was not attached');
  }
  return context;
}

function resolveRequestCommitState(
  options: GenerateChatOptions,
  reusedBudget: boolean,
): MutableRequestCommitState {
  const context = getRequestMetadataContext(options);
  if (reusedBudget && isMutableRequestCommitState(context)) return context;
  context.committed = false;
  context.exposure = 'none';
  context.terminalSeen = false;
  if (!isMutableRequestCommitState(context)) {
    throw new TypeError('Retry request commit state could not be initialized');
  }
  return context;
}

function requireRequestCommitState(
  context: RetryRequestContext,
): MutableRequestCommitState {
  const state = requestCommitStates.get(context);
  if (state === undefined) {
    throw new TypeError('Unknown retry request context');
  }
  return state;
}

function applyCommit(
  state: MutableRequestCommitState,
  exposure: StreamExposure,
): void {
  state.committed = true;
  if (EXPOSURE_STRENGTH[exposure] > EXPOSURE_STRENGTH[state.exposure]) {
    state.exposure = exposure;
  }
}

function hasRecoveryScalars(value: Record<string, unknown>): boolean {
  return (
    typeof value.totalWaitMs === 'number' &&
    typeof value.startedAtMs === 'number'
  );
}

function isRecoveryTracking(value: unknown): value is MutableRecoveryTracking {
  if (!isRecord(value) || !hasRecoveryScalars(value)) return false;
  return (
    value.visitedTargets instanceof Set &&
    value.visitedCredentialIds instanceof Set
  );
}

function deadlineRemainingFrom(
  tracking: MutableRecoveryTracking,
): number | undefined {
  if (tracking.deadlineAtMs === undefined) return undefined;
  return Math.max(0, tracking.deadlineAtMs - Date.now());
}

/**
 * Attach live recovery-accounting accessors (wait/target/credential) to a
 * request context. Object spread would snapshot the getters once, so the
 * members must be defined as real accessor properties.
 */
function attachRecoveryTrackingMembers(
  request: RetryRequestContext,
  tracking: MutableRecoveryTracking,
): void {
  Object.defineProperties(request, {
    totalWaitMs: {
      get: () => tracking.totalWaitMs,
      enumerable: true,
    },
    visitedTargets: {
      get: () => [...tracking.visitedTargets],
      enumerable: true,
    },
    visitedCredentialCount: {
      get: () => tracking.visitedCredentialIds.size,
      enumerable: true,
    },
    deadlineRemainingMs: {
      get: () => deadlineRemainingFrom(tracking),
      enumerable: true,
    },
    recordWait: {
      value: (waitMs: number) => {
        if (Number.isFinite(waitMs) && waitMs > 0) {
          tracking.totalWaitMs += waitMs;
        }
      },
      enumerable: true,
    },
    recordTarget: {
      value: (target: string) => {
        if (target.length > 0) tracking.visitedTargets.add(target);
      },
      enumerable: true,
    },
    recordCredentialId: {
      value: (credentialId: string) => {
        if (credentialId.length > 0) {
          tracking.visitedCredentialIds.add(credentialId);
        }
      },
      enumerable: true,
    },
  });
}

function resolveRecoveryTracking(
  options: GenerateChatOptions,
  reusedBudget: boolean,
  deadlineMs: number | undefined,
): MutableRecoveryTracking {
  const context = getRequestMetadataContext(options);
  const existing = context[RETRY_REQUEST_CONTEXT_KEYS.recoveryTracking];
  if (reusedBudget && isRecoveryTracking(existing)) return existing;
  const tracking: MutableRecoveryTracking = {
    totalWaitMs: 0,
    startedAtMs: Date.now(),
    deadlineAtMs:
      deadlineMs !== undefined && deadlineMs > 0
        ? Date.now() + deadlineMs
        : undefined,
    visitedTargets: new Set<string>(),
    visitedCredentialIds: new Set<string>(),
  };
  context[RETRY_REQUEST_CONTEXT_KEYS.recoveryTracking] = tracking;
  return tracking;
}

export function resolveRetryRequestContext(
  options: GenerateChatOptions,
  defaults: {
    readonly maxAttempts: number;
    readonly initialDelayMs: number;
    readonly authRetryTimeoutMs: number;
  },
): RetryRequestContext {
  const ephemerals = options.invocation?.ephemerals;
  const maxAttempts = positiveInteger(
    ephemerals?.[RETRY_EPHEMERAL_KEYS.maxAttempts],
    defaults.maxAttempts,
  );
  const budgetContext = attachTransportAttemptBudget(options, maxAttempts);
  const observationContext = attachProviderErrorObservationContext(
    budgetContext.options,
  );
  const reusedBudget = budgetContext.options === options;
  const commitState = resolveRequestCommitState(
    observationContext.options,
    reusedBudget,
  );
  const rawDeadlineMs = ephemerals?.[RETRY_EPHEMERAL_KEYS.deadlineMs];
  const deadlineMs =
    typeof rawDeadlineMs === 'number' && Number.isFinite(rawDeadlineMs)
      ? Math.max(0, rawDeadlineMs)
      : undefined;
  const tracking = resolveRecoveryTracking(
    observationContext.options,
    reusedBudget,
    deadlineMs,
  );
  const core: RetryRequestContextCore = {
    options: observationContext.options,
    budget: budgetContext.budget,
    releaseBudget: () => {
      observationContext.release();
      budgetContext.release();
    },
    get committed() {
      return commitState.committed;
    },
    get exposure() {
      return commitState.exposure;
    },
    get terminalSeen() {
      return commitState.terminalSeen;
    },
    maxAttempts,
    initialDelayMs: nonNegativeFiniteNumber(
      ephemerals?.[RETRY_EPHEMERAL_KEYS.initialDelayMs],
      defaults.initialDelayMs,
    ),
    authRetryTimeoutMs: nonNegativeFiniteNumber(
      ephemerals?.[RETRY_EPHEMERAL_KEYS.authRetryTimeoutMs],
      defaults.authRetryTimeoutMs,
    ),
    markCommitted: (exposure: StreamExposure) =>
      markRequestCommitted(request, exposure),
    markTerminalSeen: () => markTerminalSeen(request),
  };
  const request = core as RetryRequestContext;
  attachRecoveryTrackingMembers(request, tracking);
  requestCommitStates.set(request, commitState);
  return request;
}

/**
 * RetryRequestContext minus the recovery-accounting members, which are
 * attached as live accessors by attachRecoveryTrackingMembers immediately
 * after construction (spread/inline copies would not stay live).
 */
type RetryRequestContextCore = Omit<
  RetryRequestContext,
  | 'recordWait'
  | 'recordTarget'
  | 'recordCredentialId'
  | 'totalWaitMs'
  | 'visitedTargets'
  | 'visitedCredentialCount'
  | 'deadlineRemainingMs'
>;

/**
 * Irreversibly marks a request committed and upgrades its exposure.
 *
 * @param context Request context returned by resolveRetryRequestContext.
 * @param exposure Strongest output exposure observed by the caller.
 */
export function markRequestCommitted(
  context: RetryRequestContext,
  exposure: StreamExposure,
): void {
  const state = requireRequestCommitState(context);
  applyCommit(state, exposure);
}

/**
 * Locates the shared request commit state through the request options.
 *
 * The metadata record under RETRY_REQUEST_CONTEXT_KEY is the single commit
 * store: handles returned here mutate that same record, so marking from a
 * delegate layer (e.g. a load-balancer backend attempt) is immediately
 * visible to the orchestrator that owns the request context.
 *
 * @returns A commit handle, or undefined when no retry context is attached
 * (the caller then operates without shared commitment marking).
 */
export function findRequestCommitState(
  options: GenerateChatOptions,
): RequestCommitState | undefined {
  const record = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  if (!isMutableRequestCommitState(record)) return undefined;
  return {
    markCommitted(exposure: StreamExposure): void {
      applyCommit(record, exposure);
    },
    markTerminalSeen(): void {
      record.terminalSeen = true;
    },
  };
}

/** Whether the shared request commit state is currently committed. */
export function isRequestCommitted(options: GenerateChatOptions): boolean {
  const record = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  return isMutableRequestCommitState(record) && record.committed === true;
}

/**
 * Returns an immutable snapshot of the request's current commit state.
 *
 * @param context Request context returned by resolveRetryRequestContext.
 * @returns Current commitment, exposure, and terminal-event state.
 */
export function getRequestCommitState(context: RetryRequestContext): {
  readonly committed: boolean;
  readonly exposure: StreamExposure;
  readonly terminalSeen: boolean;
} {
  const state = requireRequestCommitState(context);
  return {
    committed: state.committed,
    exposure: state.exposure,
    terminalSeen: state.terminalSeen,
  };
}

/** Marks the request as having observed a terminal protocol event. */
export function markTerminalSeen(context: RetryRequestContext): void {
  requireRequestCommitState(context).terminalSeen = true;
}

/**
 * Options-only handle for recording recovery accounting from delegate
 * layers (e.g. load-balancer backend attempts) that hold request options
 * rather than the request context object.
 */
export interface RequestRecoveryTrackingHandle {
  recordTarget(target: string): void;
  recordCredentialId(credentialId: string): void;
}

export function findRequestRecoveryTracking(
  options: GenerateChatOptions,
): RequestRecoveryTrackingHandle | undefined {
  const record = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  if (!isRecord(record)) return undefined;
  const tracking = record[RETRY_REQUEST_CONTEXT_KEYS.recoveryTracking];
  if (!isRecoveryTracking(tracking)) return undefined;
  return {
    recordTarget(target: string): void {
      if (target.length > 0) tracking.visitedTargets.add(target);
    },
    recordCredentialId(credentialId: string): void {
      if (credentialId.length > 0) {
        tracking.visitedCredentialIds.add(credentialId);
      }
    },
  };
}

/**
 * Snapshot of a request's commitment and budget state, located through the
 * request options.
 *
 * Used by attempt telemetry (e.g. load-balancer backend attempts) that holds
 * options rather than the request context object. Reading through the shared
 * metadata record means the snapshot reflects marks made by any layer, taken
 * at the moment of the attempt's terminal event.
 *
 * @returns The current facts, or undefined when no retry context is attached.
 */
export function findRequestAttemptFacts(options: GenerateChatOptions):
  | {
      readonly committed: boolean;
      readonly exposure: StreamExposure;
      readonly terminalSeen: boolean;
      readonly budgetUsed: number;
      readonly budgetLimit: number;
      readonly totalWaitMs: number;
      readonly visitedTargetCount: number;
      readonly visitedCredentialCount: number;
      readonly deadlineRemainingMs: number | undefined;
    }
  | undefined {
  const record = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  if (!isMutableRequestCommitState(record)) return undefined;
  const budget = (
    record as {
      transportAttemptBudget?: { used?: unknown; limit?: unknown };
    }
  ).transportAttemptBudget;
  const budgetUsed = typeof budget?.used === 'number' ? budget.used : 0;
  const budgetLimit =
    typeof budget?.limit === 'number' ? budget.limit : budgetUsed;
  const tracking = record[RETRY_REQUEST_CONTEXT_KEYS.recoveryTracking];
  const trackingFacts = isRecoveryTracking(tracking) ? tracking : undefined;
  const totalWaitMs = trackingFacts?.totalWaitMs ?? 0;
  const visitedTargetCount = trackingFacts?.visitedTargets.size ?? 0;
  const visitedCredentialCount = trackingFacts?.visitedCredentialIds.size ?? 0;
  const deadlineRemainingMs =
    trackingFacts === undefined
      ? undefined
      : deadlineRemainingFrom(trackingFacts);
  return {
    committed: record.committed,
    exposure: record.exposure,
    terminalSeen: record.terminalSeen,
    budgetUsed,
    budgetLimit,
    totalWaitMs,
    visitedTargetCount,
    visitedCredentialCount,
    deadlineRemainingMs,
  };
}
