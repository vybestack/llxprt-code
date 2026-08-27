/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Escalation helpers for host-owned interactive authentication.
 *
 * Extracted from TokenAccessCoordinator so the coordinator gate stays small:
 * these functions build the structured challenge, drive the session-level
 * InteractiveAuthCoordinator, and map terminal outcomes to typed errors.
 *
 * @plan PLAN-20260827-ISSUE2562.P04
 * @requirement REQ-2562-3
 */

import {
  interactiveAuthCoordinator,
  InteractiveAuthCancelledError,
  InteractiveAuthError,
  type InteractiveAuthChallenge,
  type InteractiveAuthOutcome,
  type InteractiveAuthReason,
} from './interactive-auth-coordinator.js';
import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';
import {
  getActiveRuntimeIdentity,
  type RuntimeKind,
} from '../runtime/active-runtime-identity.js';

function buildInteractiveAuthRequester(
  runtimeKind: RuntimeKind | undefined,
): InteractiveAuthChallenge['requester'] {
  const identity = getActiveRuntimeIdentity();
  const runtimeId =
    identity !== undefined && identity.runtimeKind === runtimeKind
      ? identity.runtimeId
      : undefined;
  return {
    runtimeKind: runtimeKind ?? 'unregistered',
    ...(runtimeId === undefined ? {} : { runtimeId }),
  };
}

function assertInteractiveAuthSucceeded(
  outcome: InteractiveAuthOutcome,
  providerName: string,
  bucket: string,
): void {
  switch (outcome.kind) {
    case 'succeeded':
      return;
    case 'cancelled':
      throw new InteractiveAuthCancelledError(
        `Interactive authentication for ${providerName}/${bucket} was cancelled at the host. Retry from the interactive host session.`,
        outcome.correlationId,
      );
    case 'timed_out':
      throw new InteractiveAuthError(
        `Interactive authentication for ${providerName}/${bucket} expired at the host. Retry from the interactive host session.`,
        outcome.kind,
        outcome.correlationId,
      );
    case 'failed':
      throw new InteractiveAuthError(
        `Interactive authentication for ${providerName}/${bucket} failed at the host: ${outcome.error?.message ?? 'Unknown authentication failure'}`,
        outcome.kind,
        outcome.correlationId,
      );
    default: {
      const exhaustive: never = outcome.kind;
      throw new InteractiveAuthError(
        `Interactive authentication for ${providerName}/${bucket} settled with an unknown outcome: ${String(exhaustive)}`,
        'failed',
        outcome.correlationId,
      );
    }
  }
}

/**
 * Escalate one interactive authentication challenge to the host-owned
 * coordinator and settle it into a typed result. Throws a typed
 * InteractiveAuthError for every non-success terminal outcome; rejects with
 * InteractiveAuthUnavailableError when no interactive host is bound.
 */
export async function requestInteractiveAuthentication(
  providerName: string,
  bucket: string,
  runtimeKind: RuntimeKind | undefined,
  reason: InteractiveAuthReason,
): Promise<void> {
  const challenge: InteractiveAuthChallenge = {
    provider: providerName,
    bucket,
    requester: buildInteractiveAuthRequester(runtimeKind),
    reason,
    correlationId: crypto.randomUUID(),
  };
  const outcome = await interactiveAuthCoordinator.requestAuth(challenge, {
    timeoutMs: oauthRuntimeBridge.getInteractiveAuthTimeoutMs(),
  });
  assertInteractiveAuthSucceeded(outcome, providerName, bucket);
}
