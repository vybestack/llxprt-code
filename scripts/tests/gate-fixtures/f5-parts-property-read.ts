/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-parts-property-read.ts — Finding #2 adversarial PASS (must fail) fixture.
 *
 * Contains a direct `.parts` property READ on a message object:
 * `message.parts`. This is a Google-shaped structural access pattern
 * (neutral IContent uses `.blocks`, not `.parts`). The current checkF5 only
 * detects spread-assignment patterns, missing direct property reads.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function readParts(message: { parts: unknown[] }): unknown[] {
  return message.parts;
}
