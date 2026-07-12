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

function delegateMethod(wrapped: unknown, methodName: string): unknown {
  const candidate = wrapped as Record<string, unknown>;
  const method = candidate[methodName];
  if (typeof method === 'function') {
    return (method as (this: unknown) => unknown).call(wrapped);
  }
  return undefined;
}

export function delegateGetStats(wrapped: unknown): unknown {
  return delegateMethod(wrapped, 'getStats');
}

export function delegateGetLoadBalancerConfig(wrapped: unknown): unknown {
  return delegateMethod(wrapped, 'getLoadBalancerConfig');
}
