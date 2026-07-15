/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions, IProvider } from './IProvider.js';
import {
  tryConsumeTransportAttempt,
  type TransportAttemptBudget,
} from './transportAttemptBudget.js';

export function providerOwnsTransportAttempts(provider: IProvider): boolean {
  return provider.transportAttemptOwnership === 'provider';
}

export function beginProviderTransportAttempt(
  providerOwnsAttempts: boolean,
  options: GenerateChatOptions,
): void {
  if (!providerOwnsAttempts) tryConsumeTransportAttempt(options);
}

export function accountProviderAttempt(
  provider: IProvider,
  options: GenerateChatOptions,
  budget: TransportAttemptBudget,
  usedBefore: number,
): void {
  if (providerOwnsTransportAttempts(provider) && budget.used === usedBefore) {
    tryConsumeTransportAttempt(options);
  }
}

export function createInitialRetryState(initialDelayMs: number): {
  attempt: number;
  currentDelay: number;
  consecutive429s: number;
  consecutiveAuthErrors: number;
  consecutiveNetworkErrors: number;
} {
  return {
    attempt: 0,
    currentDelay: initialDelayMs,
    consecutive429s: 0,
    consecutiveAuthErrors: 0,
    consecutiveNetworkErrors: 0,
  };
}
