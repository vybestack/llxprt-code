/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

interface CompressionCooldownLogger {
  debug(message: string, details: Record<string, number>): void;
}

export function notifyCompressionCooldown(
  enabled: boolean,
  failureCount: number,
  failureThreshold: number,
  lastFailureTime: number | null,
  cooldownMs: number,
  onCooldown: (failureCount: number, lastFailureTime: number) => void,
): boolean {
  if (
    !enabled ||
    failureCount < failureThreshold ||
    lastFailureTime === null ||
    Date.now() - lastFailureTime >= cooldownMs
  ) {
    return false;
  }
  onCooldown(failureCount, lastFailureTime);
  return true;
}

export function compressionCooldownResult(
  bypassCooldown: boolean,
  failureCount: number,
  lastFailureTime: number | null,
  failureThreshold: number,
  cooldownMs: number,
  logger: CompressionCooldownLogger,
): PerformCompressionResult | null {
  const inCooldown = notifyCompressionCooldown(
    !bypassCooldown,
    failureCount,
    failureThreshold,
    lastFailureTime,
    cooldownMs,
    (count, time) =>
      logger.debug(
        'Skipping compression — in cooldown after repeated failures',
        {
          failureCount: count,
          lastFailureTime: time,
        },
      ),
  );
  return inCooldown ? PerformCompressionResult.SKIPPED_COOLDOWN : null;
}

export function wasRecentlyCompressed(
  lastCompressionTime: number | null,
  windowMs: number,
): boolean {
  return (
    lastCompressionTime !== null && Date.now() - lastCompressionTime < windowMs
  );
}
