/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * safe-type-neutral-const.ts — P31 FALSE-POSITIVE-GUARD fixture for
 * value-aware Type detection on a CONST object (not a type alias).
 *
 * Contains a local `const Type = { string: 'string', object: 'object' }`
 * — a const object named `Type` but with NEUTRAL lowercase values.
 *
 * checkE MUST SPARE this (value-aware: Google Type values are UPPERCASE,
 * neutral ones are lowercase).
 *
 * `--enforce-imports` MUST exit 0.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const Type = {
  string: 'string',
  object: 'object',
  array: 'array',
} as const;

export function useType(type: Type): void {
  void type;
}
