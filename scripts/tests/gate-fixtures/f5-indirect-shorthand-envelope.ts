/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-indirect-shorthand-envelope.ts — Finding #5 adversarial FAIL (must flag)
 * fixture.
 *
 * Builds the candidates/content/parts envelope INDIRECTLY via separate
 * variable assignments using shorthand properties:
 *
 *   const role = 'model';
 *   const parts: unknown[] = [];
 *   const content = { role, parts };
 *   const candidate = { content };
 *   return { candidates: [candidate] };
 *
 * This must be detected by F1 (candidates envelope) and/or F3
 * (role+parts envelope) even though no single inline object literal
 * contains the full Gemini shape.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function makeResponse(): unknown {
  const role = 'model';
  const parts: unknown[] = [];
  const content = { role, parts };
  const candidate = { content };
  return { candidates: [candidate] };
}
