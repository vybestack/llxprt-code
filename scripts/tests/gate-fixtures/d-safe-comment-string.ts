/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * d-safe-comment-string.ts — Finding #3 adversarial FAIL (must pass) fixture.
 *
 * Contains `streamChunkWrapper` ONLY in a comment and a string literal — NOT
 * as an actual declaration or reference. This must NOT be flagged.
 *
 * `--enforce-imports` MUST exit 0.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

// streamChunkWrapper was deleted in P25
const note = 'streamChunkWrapper is gone';
export const description = note;
