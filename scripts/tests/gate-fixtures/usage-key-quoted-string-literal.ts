/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * usage-key-quoted-string-literal.ts — P31 Finding #2 fixture.
 *
 * Contains a Gemini usage key as a QUOTED STRING-LITERAL property key
 * in an object literal: `{ 'promptTokenCount': 1 }`. The current checkH
 * only detects Identifier property names, missing StringLiteral keys.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function buildUsageStatsQuoted(): Record<string, unknown> {
  return {
    promptTokenCount: 1,
    totalTokenCount: 100,
  };
}
