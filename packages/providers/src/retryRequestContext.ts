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
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly authRetryTimeoutMs: number;
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
  const configuredAttempts =
    (ephemerals?.['retries'] as number | undefined) ?? defaults.maxAttempts;
  const maxAttempts = Math.max(1, Math.floor(configuredAttempts));
  const budgetContext = attachTransportAttemptBudget(options, maxAttempts);
  const requestOptions = attachProviderErrorObservationContext(
    budgetContext.options,
  );
  return {
    options: requestOptions,
    budget: budgetContext.budget,
    maxAttempts,
    initialDelayMs:
      (ephemerals?.['retrywait'] as number | undefined) ??
      defaults.initialDelayMs,
    authRetryTimeoutMs:
      (ephemerals?.['auth-retry-timeout'] as number | undefined) ??
      defaults.authRetryTimeoutMs,
  };
}
