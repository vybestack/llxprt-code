/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * usage-key-bracket-access.ts — P31 Finding #2 fixture.
 *
 * Contains a Gemini usage key accessed via BRACKET/ELEMENT access:
 * `usage['promptTokenCount']`. The current checkH only detects
 * PropertyAccessExpression (dot access), missing ElementAccessExpression
 * with StringLiteral argument.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export function readUsageCount(usage: Record<string, number>): number {
  return usage['promptTokenCount'] ?? 0;
}
