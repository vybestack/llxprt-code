/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionMetricUpdates } from '@vybestack/llxprt-code-telemetry';

export function publishClientPromptTokens(
  tokenCount: number | undefined,
  metrics: SessionMetricUpdates,
): void {
  if (tokenCount !== undefined) metrics.setLastPromptTokenCount(tokenCount);
}
