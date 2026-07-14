/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * eventAdapter-outside-mapper.ts — P31 AST-context proof fixture.
 *
 * This file is named to match the eventAdapter.ts allow-list entry's
 * file suffix. It contains a Gemini usage key inside a function that is
 * NOT `usageStatsToPublicUsageMetadata` — proving the exemption is
 * AST-context-keyed (function body), NOT file-level.
 *
 * `--enforce-imports` MUST exit non-zero (the hit is outside the mapper).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function someOtherFunction(): Record<string, unknown> {
  return {
    promptTokenCount: 10,
  };
}
