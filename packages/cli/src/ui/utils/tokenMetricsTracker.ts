/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TokenMetricsSnapshot {
  tokensPerMinute: number;
  throttleWaitTimeMs: number;
  sessionTokenTotal: number;
  timeToFirstToken: number | null;
  tokensPerSecond: number;
}

export interface ProviderMetricsLike {
  tokensPerMinute?: number | null;
  throttleWaitTimeMs?: number | null;
  timeToFirstToken?: number | null;
  tokensPerSecond?: number | null;
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
    timeToFirstToken: metrics?.timeToFirstToken ?? null,
    tokensPerSecond: metrics?.tokensPerSecond ?? 0,
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
  const rateChanged =
    next.tokensPerMinute !== previous.tokensPerMinute ||
    next.tokensPerSecond !== previous.tokensPerSecond;
  const timingChanged =
    next.throttleWaitTimeMs !== previous.throttleWaitTimeMs ||
    next.timeToFirstToken !== previous.timeToFirstToken;
  const totalChanged = next.sessionTokenTotal !== previous.sessionTokenTotal;
  return rateChanged || timingChanged || totalChanged;
}
