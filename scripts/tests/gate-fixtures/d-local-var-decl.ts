/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * d-local-var-decl.ts — Finding #3 adversarial PASS (must fail) fixture.
 *
 * Declares a local variable named `providerStopReason`. The current checkD
 * only detects imports/type-refs/calls, missing local variable DECLARATIONS.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const providerStopReason = 'STOP';
