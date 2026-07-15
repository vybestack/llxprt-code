/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';
import { attachProviderErrorObservationContext } from './providerErrorObservation.js';
import {
  attachTransportAttemptBudget,
  type TransportAttemptBudget,
} from './transportAttemptBudget.js';

export interface RetryRequestContext {
  readonly options: GenerateChatOptions;
  readonly budget: TransportAttemptBudget;
  readonly releaseBudget: () => void;
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly authRetryTimeoutMs: number;
}

const RETRY_EPHEMERAL_KEYS = {
  maxAttempts: 'retries',
  initialDelayMs: 'retrywait',
  authRetryTimeoutMs: 'auth-retry-timeout',
};

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
  return {
    options: observationContext.options,
    budget: budgetContext.budget,
    releaseBudget: () => {
      observationContext.release();
      budgetContext.release();
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
  };
}
