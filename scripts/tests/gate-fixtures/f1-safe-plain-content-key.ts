/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f1-safe-plain-content-key.ts — Finding #2 adversarial FAIL (must pass) fixture.
 *
 * Contains `{candidates:[{content:{foo:'bar'}}]}` — content is an object
 * but has NO `role` or `parts`. This is NOT a Gemini envelope (Gemini
 * content always has role/parts) and must NOT be flagged.
 *
 * `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const domainModel = {
  candidates: [{ content: { foo: 'bar', baz: 42 } }],
};
