/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * f5-safe-blocks-read.ts — Finding #2 adversarial FAIL (must pass) fixture.
 *
 * Contains a neutral IContent `.blocks` property read (NOT `.parts`).
 * This is the neutral pattern and must NOT be flagged.
 *
 * `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function readBlocks(content: { blocks: unknown[] }): unknown[] {
  return content.blocks;
}
