/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * type-enum-redeclaration.ts — P31 NEGATIVE fixture triggering checkE
 * (value-aware Type detection).
 *
 * Contains a local `const Type = { STRING: 'STRING', OBJECT: 'OBJECT' }`
 * — a Google-Type-enum-shaped re-declaration carrying Google's uppercase
 * string values.
 *
 * `--enforce-imports` MUST exit non-zero.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export const Type = {
  STRING: 'STRING',
  OBJECT: 'OBJECT',
  ARRAY: 'ARRAY',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
} as const;

export function useType(type: Type): void {
  void type;
}
