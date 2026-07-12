/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20270110-ISSUE2378.P05
 * @requirement:REQ-2378-005
 *
 * Public agent-bootstrap preflight entrypoint (#2378).
 *
 * The interactive CLI bootstrap needs the provider-activation auth outcome
 * BEFORE the foreground Agent is constructed: the sandbox-hop decision
 * (maybeHopIntoSandbox) and the fatal-exit path (FATAL_AUTHENTICATION_ERROR)
 * both depend on whether auth succeeded, and both must run before agent
 * construction so the observable process lifecycle is preserved.
 *
 * Previously the CLI reached for the runtime primitive
 * `executeProviderActivation` directly. That primitive is a runtime-assembly
 * seam owned by the agents package. `preflightAgentActivation` is the public,
 * purpose-named boundary the CLI calls with a DECLARATIVE
 * {@link ProviderActivationIntent}; it owns the activation primitive internally
 * and returns the typed declarative result the CLI needs to make the
 * sandbox/fatal-auth decisions. The Config that this preflight activates is the
 * SAME Config later adopted by `fromConfig`/`createAgent`, whose executor
 * fast-path (already-active + no overrides) adopts the preflight state WITHOUT
 * re-running a second activation sequence.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderActivationIntent } from './config-types.js';
import {
  executeProviderActivation,
  type ProviderActivationResult,
} from './providerActivationExecutor.js';
import {
  clearCompletedActivationPreflight,
  recordCompletedActivationPreflight,
  type ActivationPreflightToken,
} from './activationPreflightState.js';

/**
 * The declarative result of a pre-agent activation preflight. Mirrors
 * {@link ProviderActivationResult}: `authFailed` is the fatal-auth signal the
 * CLI maps to FATAL_AUTHENTICATION_ERROR, `authError` carries the underlying
 * cause, `activeProvider` is the post-activation provider name, and
 * `infoMessages` / `switchError` surface non-fatal diagnostics.
 */
export type AgentActivationPreflightResult = ProviderActivationResult & {
  readonly token?: ActivationPreflightToken;
};

/**
 * Runs the pre-agent provider-activation preflight against a live Config,
 * owning the activation primitive internally. Does NOT throw on auth failure —
 * the outcome is returned as data so the CLI can decide sandbox-hop / fatal-exit
 * behavior from `result.authFailed` before constructing the Agent.
 *
 * @param config The resolved CLI Config (later adopted by agent construction).
 * @param intent The declarative provider-activation / auth intent.
 * @returns The typed preflight result.
 */
export async function preflightAgentActivation(
  config: Config,
  intent: ProviderActivationIntent,
): Promise<AgentActivationPreflightResult> {
  // Invalidate the most-recent token for this Config so a new attempt does not
  // leave a stale "latest" pointer.
  clearCompletedActivationPreflight(config);

  let result: ProviderActivationResult;
  try {
    result = await executeProviderActivation(config, intent);
  } catch (error) {
    // Honor the no-throw contract: convert any unexpected throw into a
    // structured fatal-auth result so the CLI's sandbox-hop /
    // FATAL_AUTHENTICATION_ERROR path remains intact.
    result = {
      authFailed: true,
      infoMessages: [],
      authError: error,
    };
  }

  // Bind the token to the immutable canonical intent + runtime identity.
  // Failed activations never produce a token (no stale ambient adoption).
  const token = recordCompletedActivationPreflight(config, result, intent);
  return token === undefined ? result : { ...result, token };
}
