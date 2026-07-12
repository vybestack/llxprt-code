/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f3-quoted-role-parts.ts — Finding #2 adversarial PASS (must fail) fixture.
 *
 * Contains a structural Gemini envelope with QUOTED string-literal keys for
 * `role` and `parts`. The current checkF3 only matches identifier keys.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const envelope = {
  role: 'user',
  parts: [{ text: 'quoted keys envelope' }],
};
