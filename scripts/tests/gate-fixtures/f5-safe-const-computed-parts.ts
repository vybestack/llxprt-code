/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-safe-const-computed-parts.ts — F5 const-computed key adversarial
 * PASS (must NOT flag) fixture.
 *
 * Accesses `.parts` via a const-computed bracket key on an UNRELATED
 * domain object that does NOT have Google Content provenance (no role,
 * no Part-shaped array values):
 *
 *   const key = 'parts';
 *   const domain = { parts: ['wheel'] };
 *   return domain[key];
 *
 * This must NOT be flagged by F5 because `domain` lacks Google-shaped
 * provenance (no role:'user'|'model', no Part objects in parts array,
 * not derived from a candidates envelope).
 *
 * `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function readDomainPartsViaConstKey(): unknown {
  const key = 'parts';
  const domain = { parts: ['wheel'] };
  return domain[key];
}
