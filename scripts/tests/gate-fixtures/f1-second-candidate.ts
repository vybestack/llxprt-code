/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f1-second-candidate.ts — Finding #2 adversarial PASS (must fail) fixture.
 *
 * Contains a candidates envelope where the FIRST candidate is a plain object
 * without content, but the SECOND candidate has `{content:{parts:[...]}}`.
 * The current checkF1 only inspects the first element, missing the second.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const envelope = {
  candidates: [
    { foo: 'bar' },
    { content: { parts: [{ text: 'hidden in second' }] } },
  ],
};
