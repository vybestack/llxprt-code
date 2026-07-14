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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTransportAttemptBudget(
  value: unknown,
): value is TransportAttemptBudget {
  if (!isRecord(value)) return false;
  if (typeof value.limit !== 'number') return false;
  if (!Number.isInteger(value.limit) || value.limit <= 0) return false;
  if (typeof value.used !== 'number') return false;
  return Number.isInteger(value.used) && value.used >= 0;
}

function getRequestContext(
  options: GenerateChatOptions,
): Record<string, unknown> | undefined {
  const value = options.metadata?.[RETRY_REQUEST_CONTEXT_KEY];
  return isRecord(value) ? value : undefined;
}

export function attachTransportAttemptBudget(
  options: GenerateChatOptions,
  limit: number,
): { options: GenerateChatOptions; budget: TransportAttemptBudget } {
  const existingContext = getRequestContext(options);
  const existing = existingContext?.[TRANSPORT_ATTEMPT_BUDGET_KEY];
  if (isTransportAttemptBudget(existing)) {
    return { options, budget: existing };
  }
  const budget: TransportAttemptBudget = {
    limit: Math.max(1, Math.floor(limit)),
    used: 0,
  };
  const requestContext = existingContext ?? {};
  requestContext[TRANSPORT_ATTEMPT_BUDGET_KEY] = budget;
  return {
    options: {
      ...options,
      metadata: {
        ...options.metadata,
        [RETRY_REQUEST_CONTEXT_KEY]: requestContext,
      },
    },
    budget,
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

export function consumeTransportAttempt(options: GenerateChatOptions): boolean {
  const budget = getTransportAttemptBudget(options);
  if (budget === undefined) return true;
  if (budget.used >= budget.limit) return false;
  budget.used++;
  return true;
}
