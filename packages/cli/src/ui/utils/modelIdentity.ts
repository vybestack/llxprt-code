/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * Placeholder shown for a load-balancer sub-profile or model that has not yet
 * been selected for the current session.
 */
export const LB_PENDING_PLACEHOLDER = 'none';

const LOAD_BALANCER_PROVIDER_NAME = 'load-balancer';
const UNKNOWN_IDENTITY = 'unknown';

export interface LoadBalancerIdentity {
  profileName: string;
  activeSubProfile: string | null;
  activeModel: string | null;
}

export interface ModelIdentityInput {
  profileName: string | null;
  providerName: string | null;
  modelName: string | null;
  fallback?: string;
}

interface LoadBalancerStatsShape {
  profileName?: string;
  lastSelected?: string | null;
  lastSelectedModel?: string | null;
}

export interface ModelIdentityRuntime {
  providerStatus: () => {
    providerName: string | null;
    modelName: string | null;
  };
  getActiveProfileName: () => string | null;
  getLoadBalancerStats: () => LoadBalancerStatsShape | undefined;
}

function cleaned(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Format a load-balancer identity string: `lb:<lbProfile>:<subProfile>:<model>`.
 * Missing sub-profile/model render as the pending placeholder. This is the sole
 * source of truth for the LB identity; standard fields (profile/provider/model)
 * do not participate.
 */
export function formatLoadBalancerIdentity(lb: LoadBalancerIdentity): string {
  const lbName = cleaned(lb.profileName) ?? LOAD_BALANCER_PROVIDER_NAME;
  const sub = cleaned(lb.activeSubProfile) ?? LB_PENDING_PLACEHOLDER;
  const model = cleaned(lb.activeModel) ?? LB_PENDING_PLACEHOLDER;
  return `lb:${lbName}:${sub}:${model}`;
}

function joinPrimaryAndModel(
  primary: string,
  modelName: string | null,
): string {
  const model = cleaned(modelName);
  return model ? `${primary}:${model}` : primary;
}

/**
 * Build the user-facing model identity string for non-load-balancer sessions.
 * Load-balancer sessions are formatted separately via
 * {@link formatLoadBalancerIdentity}.
 *
 * - Standard profile sessions: `<profile>:<model>` (or `<profile>`).
 * - Direct provider sessions: `<provider>:<model>` (or `<provider>` / `<model>`).
 * - Otherwise the supplied fallback, or `unknown`.
 */
export function formatModelIdentity(input: ModelIdentityInput): string {
  const profileName = cleaned(input.profileName);
  if (profileName) {
    return joinPrimaryAndModel(profileName, input.modelName);
  }

  const providerName = cleaned(input.providerName);
  if (providerName) {
    return joinPrimaryAndModel(providerName, input.modelName);
  }

  const modelName = cleaned(input.modelName);
  if (modelName) {
    return modelName;
  }

  return cleaned(input.fallback) ?? UNKNOWN_IDENTITY;
}

function readLoadBalancerStats(
  runtime: ModelIdentityRuntime,
): LoadBalancerStatsShape | null {
  try {
    return runtime.getLoadBalancerStats() ?? null;
  } catch (error) {
    // Graceful degradation: the footer falls back to `none` placeholders.
    // Log (debug-only) so operators can diagnose why, instead of failing
    // silently like the rest of the load-balancer paths avoid.
    debugLogger.debug(
      () => `[modelIdentity] Failed to read load-balancer stats: ${error}`,
    );
    return null;
  }
}

/**
 * Resolve the current model identity from runtime accessors, applying
 * load-balancer awareness when the active provider is a load balancer.
 */
export function resolveModelIdentity(
  runtime: ModelIdentityRuntime,
  fallback?: string,
): string {
  const status = runtime.providerStatus();
  const profileName = runtime.getActiveProfileName();

  if (status.providerName === LOAD_BALANCER_PROVIDER_NAME) {
    const stats = readLoadBalancerStats(runtime);
    return formatLoadBalancerIdentity({
      profileName:
        cleaned(stats?.profileName) ??
        cleaned(profileName) ??
        LOAD_BALANCER_PROVIDER_NAME,
      activeSubProfile: stats?.lastSelected ?? null,
      activeModel: stats?.lastSelectedModel ?? null,
    });
  }

  return formatModelIdentity({
    profileName,
    providerName: status.providerName,
    modelName: status.modelName,
    fallback,
  });
}

export function createCliModelIdentityRuntime(
  agent: Pick<
    Agent,
    | 'getProvider'
    | 'getModel'
    | 'getCurrentSequenceModel'
    | 'getActiveProfileName'
  >,
): ModelIdentityRuntime {
  return {
    providerStatus: () => ({
      providerName: agent.getProvider(),
      modelName: agent.getCurrentSequenceModel() ?? agent.getModel(),
    }),
    getActiveProfileName: () => agent.getActiveProfileName(),
    getLoadBalancerStats: () => undefined,
  };
}

/**
 * Resolve the content-prefix identity for a response: `profileName:modelName`
 * (NO load-balancer quad). Returns `null` when no profile is active so callers
 * can omit the prefix entirely. For load-balancer profiles, the active
 * sub-profile model is used (falling back to the LB provider's model name).
 */
export function resolveContentPrefixIdentity(
  runtime: ModelIdentityRuntime,
): string | null {
  const status = runtime.providerStatus();
  const profileName = cleaned(runtime.getActiveProfileName());
  if (!profileName) {
    return null;
  }
  let model: string | null;
  if (status.providerName === LOAD_BALANCER_PROVIDER_NAME) {
    const stats = readLoadBalancerStats(runtime);
    model = cleaned(stats?.lastSelectedModel) ?? cleaned(status.modelName);
  } else {
    model = cleaned(status.modelName);
  }
  return joinPrimaryAndModel(profileName, model);
}
