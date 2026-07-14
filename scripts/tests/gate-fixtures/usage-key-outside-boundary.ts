/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * usage-key-outside-boundary.ts — P31 NEGATIVE fixture triggering checkH.
 *
 * Contains a Gemini usage key (promptTokenCount) in an object literal
 * inside a function that is NOT the boundary mapper
 * (usageStatsToPublicUsageMetadata). This proves checkH fires on usage
 * keys outside boundary modules.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function buildUsageStats(): Record<string, unknown> {
  return {
    promptTokenCount: 42,
    totalTokenCount: 100,
  };
}
