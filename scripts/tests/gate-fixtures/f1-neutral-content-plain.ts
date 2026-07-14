/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f1-neutral-content-plain.ts — Finding #2 adversarial FAIL (must pass) fixture.
 *
 * Contains a neutral domain object: `{candidates:[{content:'plain string'}]}`.
 * Here `content` is a plain string, NOT an object with `role` or `parts`.
 * This is NOT a Gemini structural envelope and must NOT be flagged.
 *
 * `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const domainModel = {
  candidates: [{ content: 'plain string not a gemini content object' }],
};
