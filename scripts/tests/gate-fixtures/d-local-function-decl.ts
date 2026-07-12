/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * d-local-function-decl.ts — Finding #3 adversarial PASS (must fail) fixture.
 *
 * Declares a local function named `streamChunkWrapper`. The current checkD
 * only detects imports/type-refs/calls, missing local DECLARATIONS of
 * deleted-helper symbols.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function streamChunkWrapper(): void {
  // local re-declaration of a deleted-helper symbol
}
