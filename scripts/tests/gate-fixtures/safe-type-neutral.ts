/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * safe-type-neutral.ts — P31 FALSE-POSITIVE-GUARD fixture for value-aware
 * Type detection.
 *
 * Contains a local `type Type = 'string' | 'object' | 'array'` — a
 * lowercase neutral type alias that shares the NAME `Type` with Google's
 * Type enum but carries NEUTRAL lowercase values.
 *
 * checkE MUST SPARE this (value-aware: Google Type values are UPPERCASE,
 * neutral ones are lowercase).
 *
 * `--enforce-imports` MUST exit 0.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export type Type = 'string' | 'object' | 'array';

export function useType(type: Type): void {
  void type;
}
