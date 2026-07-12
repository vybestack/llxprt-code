/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-parts-element-read.ts — Finding #2 adversarial PASS (must fail) fixture.
 *
 * Contains a bracket/element access READ on `.parts`:
 * `content['parts']`. The current checkF5 only detects spread-assignment,
 * missing element-access reads.
 *
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function readPartsElement(content: Record<string, unknown>): unknown {
  return content['parts'];
}
