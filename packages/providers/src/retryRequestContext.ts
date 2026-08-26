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
  readonly committed: boolean;
  readonly exposure: StreamExposure;
  readonly terminalSeen: boolean;
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly authRetryTimeoutMs: number;
}

interface MutableRequestCommitState {
  committed: boolean;
  exposure: StreamExposure;
  terminalSeen: boolean;
}

const requestCommitStates = new WeakMap<
  RetryRequestContext,
  MutableRequestCommitState
>();

const RETRY_EPHEMERAL_KEYS = {
  maxAttempts: 'retries',
  initialDelayMs: 'retrywait',
  authRetryTimeoutMs: 'auth-retry-timeout',
};

const EXPOSURE_STRENGTH: Readonly<Record<StreamExposure, number>> = {
  none: 0,
  metadata: 1,
  content: 2,
  tool_call: 3,
};

/**
 * Structural seam through which any wrapper layer (guarded stream, load
 * balancer backend attempt) marks the request's shared commit state. A
 * RetryRequestContext satisfies this interface; an options-only caller can
 * obtain a handle via findRequestCommitState.
 */
export interface RequestCommitState {
  markCommitted(exposure: StreamExposure): void;
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
  const commitState = resolveRequestCommitState(
    observationContext.options,
    budgetContext.options === options,
  );
  const request: RetryRequestContext = {
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
  };
  requestCommitStates.set(request, commitState);
  return request;
}

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
