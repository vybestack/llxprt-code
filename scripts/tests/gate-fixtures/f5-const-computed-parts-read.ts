/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-const-computed-parts-read.ts — F5 const-computed key adversarial
 * FAIL (must flag) fixture.
 *
 * Builds a Google Content-shaped object (role + parts) and accesses
 * `.parts` via a const-computed bracket key:
 *
 *   const key = 'parts';
 *   const wire = { role: 'model', parts: [{ text: 'hi' }] };
 *   return wire[key];
 *
 * The gate MUST resolve the const identifier `key` to `'parts'` and flag
 * this as a Google-shaped .parts access, even though the key is not a
 * direct string literal.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function readPartsViaConstKey(): unknown {
  const key = 'parts';
  const wire = { role: 'model', parts: [{ text: 'hi' }] };
  return wire[key];
}
