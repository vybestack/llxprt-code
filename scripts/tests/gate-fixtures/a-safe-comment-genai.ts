/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * a-safe-comment-genai.ts — Finding #3 adversarial FAIL (must pass) fixture.
 *
 * Contains `@google/genai` ONLY in a comment and a string literal — NOT as
 * an actual import/require/dynamic-import. This must NOT be flagged.
 *
 * `--enforce-imports` MUST exit 0.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

// This file does NOT import from @google/genai
const moduleName = '@google/genai';
export const description = `banned module is ${moduleName}`;
