/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-safe-domain-parts.ts — Finding #5 adversarial PASS (must NOT flag)
 * fixture.
 *
 * Contains `.parts` property access on an UNRELATED domain object that
 * happens to have a `parts` property but does NOT have Google Content
 * provenance (no role, no Part-shaped array values):
 *
 *   const domain = { parts: ['wheel'] };
 *   return domain.parts.length;
 *
 * This must NOT be flagged by F5 because the value lacks Google-shaped
 * provenance (no role:'user'|'model', no Part objects in parts array,
 * not derived from a candidates envelope).
 *
 * `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function countWheels(): number {
  const domain = { parts: ['wheel'] };
  return domain.parts.length;
}
