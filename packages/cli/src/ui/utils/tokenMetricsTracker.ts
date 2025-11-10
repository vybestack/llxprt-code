/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TokenMetricsSnapshot {
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  sessionTokenTotal: number;
}

export interface ProviderMetricsLike {
  tokensPerMinute?: number | null;
  throttleWaitTimeMs?: number | null;
}

export interface SessionTokenUsage {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
}

export function toTokenMetricsSnapshot(
  metrics: ProviderMetricsLike | null | undefined,
  usage: SessionTokenUsage | null | undefined,
): TokenMetricsSnapshot {
  return {
    tokensPerMinute: metrics?.tokensPerMinute ?? 0,
    throttleWaitTimeMs: metrics?.throttleWaitTimeMs ?? 0,
    sessionTokenTotal: usage?.total ?? 0,
  };
}

export function shouldUpdateTokenMetrics(
  previous: TokenMetricsSnapshot | null,
  metrics: ProviderMetricsLike | null | undefined,
  usage: SessionTokenUsage | null | undefined,
): boolean {
  if (!previous) {
    return true;
  }
  const next = toTokenMetricsSnapshot(metrics, usage);
  return (
    next.tokensPerMinute !== previous.tokensPerMinute ||
    next.throttleWaitTimeMs !== previous.throttleWaitTimeMs ||
    next.sessionTokenTotal !== previous.sessionTokenTotal
  );
}
