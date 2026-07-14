/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f-const-computed-envelope.ts — const computed-key candidates/content/role/parts.
 *
 * `const k = 'candidates'; const env = { [k]: [{ content: { role: 'user', parts: [] } }] };`
 * The gate MUST resolve const-computed keys to their literal values and reject
 * the Google-shaped envelope.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function makeEnvelope(): unknown {
  const ck = 'candidates';
  const rk = 'role';
  const pk = 'parts';
  return {
    [ck]: [{ content: { [rk]: 'user', [pk]: [{ text: 'hi' }] } }],
  };
}
