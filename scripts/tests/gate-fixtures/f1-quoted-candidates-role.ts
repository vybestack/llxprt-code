/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f1-quoted-candidates-role.ts — Finding #2 adversarial PASS fixture.
 *
 * Contains a candidates envelope with a QUOTED string-literal property key
 * for `candidates` and `content`, where `content` is an object with `role`
 * (a Gemini Content shape). The current checkF1 only matches identifier
 * keys and only checks `first`, missing quoted-key and second-candidate forms.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const envelope = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ text: 'second candidate with role' }],
      },
    },
  ],
};
