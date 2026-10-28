/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';

/**
 * Metadata key holding the per-request retry context object shared across
 * orchestrator attempts (budget + request-scoped recovery state). Exported so
 * providers can attach request-scoped state that must survive outer retries.
 */
export const RETRY_REQUEST_CONTEXT_KEY = '_retryRequestContext';
const TRANSPORT_ATTEMPT_BUDGET_KEY = 'transportAttemptBudget';

export interface TransportAttemptBudget {
  readonly limit: number;
  used: number;
}

interface BudgetLifecycle {
  leases: number;
}

const BUDGET_LIFECYCLE = Symbol('transportAttemptBudgetLifecycle');
interface OwnedTransportAttemptBudget extends TransportAttemptBudget {
  readonly [BUDGET_LIFECYCLE]?: BudgetLifecycle;
}

function normalizeTransportAttemptLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTransportAttemptBudget(
  value: unknown,
): value is TransportAttemptBudget {
  if (!isRecord(value)) return false;
  if (typeof value.limit !== 'number') return false;
  if (!Number.isInteger(value.limit) || value.limit <= 0) return false;
  if (typeof value.used !== 'number') return false;
  return (
    Number.isInteger(value.used) && value.used >= 0 && value.used <= value.limit
  );
}

function getRequestContext(options: {
  readonly metadata?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const value = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  return isRecord(value) ? value : undefined;
}

export interface AttachedTransportAttemptBudget {
  readonly options: GenerateChatOptions;
  readonly budget: TransportAttemptBudget;
  release(): void;
}

function acquireBudgetLifecycle(
  budget: TransportAttemptBudget,
): BudgetLifecycle | undefined {
  const owned: OwnedTransportAttemptBudget = budget;
  const lifecycle = owned[BUDGET_LIFECYCLE];
  if (lifecycle === undefined || lifecycle.leases === 0) return undefined;
  lifecycle.leases += 1;
  return lifecycle;
}

function createBudgetLifecycle(
  budget: TransportAttemptBudget,
): BudgetLifecycle {
  const lifecycle: BudgetLifecycle = { leases: 1 };
  Object.defineProperty(budget, BUDGET_LIFECYCLE, { value: lifecycle });
  return lifecycle;
}

function releaseBudgetLifecycle(lifecycle: BudgetLifecycle): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lifecycle.leases -= 1;
  };
}

export function attachTransportAttemptBudget(
  options: GenerateChatOptions,
  limit: number,
): AttachedTransportAttemptBudget {
  const existingContext = getRequestContext(options);
  const existing = existingContext?.[TRANSPORT_ATTEMPT_BUDGET_KEY];
  if (isTransportAttemptBudget(existing)) {
    const lifecycle = acquireBudgetLifecycle(existing);
    if (lifecycle !== undefined) {
      return {
        options,
        budget: existing,
        release: releaseBudgetLifecycle(lifecycle),
      };
    }
  }
  const budget: TransportAttemptBudget = {
    limit: normalizeTransportAttemptLimit(limit),
    used: 0,
  };
  const lifecycle = createBudgetLifecycle(budget);
  const requestContext = {
    ...existingContext,
    [TRANSPORT_ATTEMPT_BUDGET_KEY]: budget,
  };
  return {
    options: {
      ...options,
      metadata: {
        ...options.metadata,
        [RETRY_REQUEST_CONTEXT_KEY]: requestContext,
      },
    },
    budget,
    release: releaseBudgetLifecycle(lifecycle),
  };
}

/**
 * Reads the transport budget a retry-context record carries.
 *
 * The record is the value stored under RETRY_REQUEST_CONTEXT_KEY; this is
 * the typed reader for code that already holds the record (e.g. attempt
 * telemetry snapshots) so the key stays owned by this module.
 */
export function readTransportAttemptBudgetFromRecord(
  record: Record<string, unknown> | undefined,
): TransportAttemptBudget | undefined {
  const value = record?.[TRANSPORT_ATTEMPT_BUDGET_KEY];
  return isTransportAttemptBudget(value) ? value : undefined;
}

export function getTransportAttemptBudget(options: {
  readonly metadata?: Record<string, unknown>;
}): TransportAttemptBudget | undefined {
  return readTransportAttemptBudgetFromRecord(getRequestContext(options));
}

export function hasTransportAttemptRemaining(options: {
  readonly metadata?: Record<string, unknown>;
}): boolean {
  const budget = getTransportAttemptBudget(options);
  return budget === undefined || budget.used < budget.limit;
}

export function tryConsumeTransportAttempt(options: {
  readonly metadata?: Record<string, unknown>;
}): boolean {
  const budget = getTransportAttemptBudget(options);
  if (budget === undefined) return true;
  if (budget.used >= budget.limit) return false;
  budget.used++;
  return true;
}
