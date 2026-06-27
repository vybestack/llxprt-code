/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export type CompressionCallback = (contents: IContent[]) => Promise<IContent[]>;

export interface LoadBalancerSubProfile {
  name: string;
  providerName: string;
  modelId?: string;
  baseURL?: string;
  authToken?: string;
}

export interface LoadBalancingProviderConfig {
  profileName: string;
  strategy: 'round-robin' | 'failover';
  subProfiles: Array<ResolvedSubProfile | LoadBalancerSubProfile>;
  contextLimit?: number;
  lbProfileEphemeralSettings?: Record<string, unknown>;
  lbProfileModelParams?: Record<string, unknown>;
}

export interface BackendMetrics {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  tokens: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: Array<{ timestamp: number; error: Error }>;
  openedAt?: number;
  lastAttempt?: number;
}

export interface LoadBalancerStats {
  profileName: string;
  totalRequests: number;
  lastSelected: string | null;
  profileCounts: Record<string, number>;
}

export interface ExtendedLoadBalancerStats extends LoadBalancerStats {
  backendMetrics: Record<string, BackendMetrics>;
  circuitBreakerStates: Record<string, CircuitBreakerState>;
  currentTPM: Record<string, number>;
}

export interface ResolvedSubProfile {
  name: string;
  providerName: string;
  model: string;
  baseURL?: string;
  authToken?: string;
  authKeyfile?: string;
  contextWindow?: number;
  ephemeralSettings: Record<string, unknown>;
  modelParams: Record<string, unknown>;
}

export interface FailoverSettings {
  retryCount: number;
  retryDelayMs: number;
  failoverOnNetworkErrors: boolean;
  failoverStatusCodes?: number[];
  tpmThreshold?: number;
  timeoutMs?: number;
  circuitBreakerEnabled: boolean;
  circuitBreakerFailureThreshold: number;
  circuitBreakerFailureWindowMs: number;
  circuitBreakerRecoveryTimeoutMs: number;
}

export function validateLoadBalancingStrategy(strategy: unknown): void {
  if (
    typeof strategy !== 'string' ||
    (strategy !== 'round-robin' && strategy !== 'failover')
  ) {
    const received = typeof strategy === 'string' ? strategy : '<non-string>';
    const sanitized = received.slice(0, 50).replace(/[\r\n\t]/g, ' ');
    throw new Error(
      `Invalid strategy "${sanitized}". Supported: "round-robin", "failover".`,
    );
  }
}

export function isResolvedSubProfile(
  profile: unknown,
): profile is ResolvedSubProfile {
  return hasResolvedSettings(profile);
}

function hasResolvedSettings(profile: unknown): profile is ResolvedSubProfile {
  if (
    profile === null ||
    profile === undefined ||
    typeof profile !== 'object' ||
    Array.isArray(profile)
  ) {
    return false;
  }
  const candidate = profile as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0
  ) {
    return false;
  }
  if (
    typeof candidate.model !== 'string' ||
    candidate.model.trim().length === 0
  ) {
    return false;
  }
  if (
    typeof candidate.providerName !== 'string' ||
    candidate.providerName.trim().length === 0
  ) {
    return false;
  }
  return (
    isRecord(candidate.ephemeralSettings) && isRecord(candidate.modelParams)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
