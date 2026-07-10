/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Delegation helpers for provider wrappers (LoggingProviderWrapper,
 * RetryOrchestrator). Wrappers sit between callers and the underlying
 * provider (e.g. LoadBalancingProvider), so optional capabilities like
 * getStats()/getLoadBalancerConfig() must be forwarded down the chain.
 * getLoadBalancerConfig() lets profile persistence serialize the ACTIVE
 * load balancer back into a genuine type:'loadbalancer' profile instead of
 * a corrupt standard profile with provider:'load-balancer' (issue #2479).
 */

export function delegateGetStats(wrapped: unknown): unknown {
  const candidate = wrapped as { getStats?: () => unknown };
  if (typeof candidate.getStats === 'function') {
    return candidate.getStats();
  }
  return undefined;
}

export function delegateGetLoadBalancerConfig(wrapped: unknown): unknown {
  const candidate = wrapped as { getLoadBalancerConfig?: () => unknown };
  if (typeof candidate.getLoadBalancerConfig === 'function') {
    return candidate.getLoadBalancerConfig();
  }
  return undefined;
}
