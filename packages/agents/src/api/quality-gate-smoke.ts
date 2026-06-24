/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P08
 * @requirement:REQ-019
 */

/**
 * Tiny pure production function used to prove Stryker/Vitest wiring before
 * the main Agent API implementation exists. The conditional branch is real
 * mutation-testable logic: Stryker will flip the condition and the spec must
 * kill the mutant.
 *
 * @param input - the string to classify
 * @returns 'empty' for the empty string, 'non-empty' otherwise
 */
export function classifyString(input: string): 'empty' | 'non-empty' {
  if (input.length === 0) {
    return 'empty';
  }
  return 'non-empty';
}
