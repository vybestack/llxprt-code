/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '../IProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';

/**
 * Determine whether a wrapper is the canonical lifecycle owner.
 *
 * Finding #1/#3: The wrapper owns lifecycle ONLY when there is no
 * RetryOrchestrator and no provider-owned transport in the chain.
 * When the transport declares transportAttemptOwnership='provider'
 * (e.g. LoadBalancingProvider), the transport owns its own attempts
 * and the wrapper must delegate, never wrapping the whole transport.
 * When a RetryOrchestrator is present, the orchestrator owns
 * per-retry-attempt lifecycle.
 */
export function isWrapperLifecycleOwner(wrapped: IProvider): boolean {
  if (wrapped.transportAttemptOwnership === 'provider') {
    return false;
  }
  if (wrapped instanceof RetryOrchestrator) {
    return false;
  }
  let candidate: IProvider | undefined = wrapped;
  while (candidate) {
    if (candidate.transportAttemptOwnership === 'provider') return false;
    if (candidate instanceof RetryOrchestrator) return false;
    const unwrapped = candidate as IProvider & {
      wrappedProvider?: IProvider;
      wrapped?: IProvider;
    };
    candidate = unwrapped.wrappedProvider ?? unwrapped.wrapped ?? undefined;
  }
  return true;
}
