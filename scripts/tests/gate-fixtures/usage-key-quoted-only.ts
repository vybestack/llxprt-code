/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * usage-key-quoted-only.ts — P31 Finding #2 fixture.
 *
 * Contains ONLY a quoted string-literal usage key property — no unquoted
 * key to accidentally trigger detection.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function buildUsageStatsQuotedOnly(): Record<string, unknown> {
  return {
    promptTokenCount: 42,
  };
}
