/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';

const RETRY_REQUEST_CONTEXT_KEY = '_retryRequestContext';
const TRANSPORT_ATTEMPT_BUDGET_KEY = 'transportAttemptBudget';

export interface TransportAttemptBudget {
  readonly limit: number;
  used: number;
}

interface BudgetLifecycle {
  readonly leases: number;
}

const budgetLifecycles = new WeakMap<TransportAttemptBudget, BudgetLifecycle>();

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

function getRequestContext(
  options: GenerateChatOptions,
): Record<string, unknown> | undefined {
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
  const lifecycle = budgetLifecycles.get(budget);
  if (lifecycle === undefined || lifecycle.leases === 0) return undefined;
  const acquired = { leases: lifecycle.leases + 1 };
  budgetLifecycles.set(budget, acquired);
  return acquired;
}

function createBudgetLifecycle(budget: TransportAttemptBudget): void {
  budgetLifecycles.set(budget, { leases: 1 });
}

function releaseBudgetLifecycle(budget: TransportAttemptBudget): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const lifecycle = budgetLifecycles.get(budget);
    if (lifecycle === undefined) return;
    budgetLifecycles.set(budget, {
      leases: Math.max(0, lifecycle.leases - 1),
    });
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
        release: releaseBudgetLifecycle(existing),
      };
    }
  }
  const budget: TransportAttemptBudget = {
    limit: normalizeTransportAttemptLimit(limit),
    used: 0,
  };
  createBudgetLifecycle(budget);
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
    release: releaseBudgetLifecycle(budget),
  };
}

export function getTransportAttemptBudget(
  options: GenerateChatOptions,
): TransportAttemptBudget | undefined {
  const value = getRequestContext(options)?.[TRANSPORT_ATTEMPT_BUDGET_KEY];
  return isTransportAttemptBudget(value) ? value : undefined;
}

export function hasTransportAttemptRemaining(
  options: GenerateChatOptions,
): boolean {
  const budget = getTransportAttemptBudget(options);
  return budget === undefined || budget.used < budget.limit;
}

export function tryConsumeTransportAttempt(
  options: GenerateChatOptions,
): boolean {
  const budget = getTransportAttemptBudget(options);
  if (budget === undefined) return true;
  if (budget.used >= budget.limit) return false;
  budget.used++;
  return true;
}
