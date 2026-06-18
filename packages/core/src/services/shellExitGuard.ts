/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mutable exit-flag wrapper used by shell execution helpers.
 *
 * The value is read via a method (`isExited()`) rather than a direct
 * property access so that type-checker-based lint rules (notably
 * `@typescript-eslint/no-unnecessary-condition`) do not narrow the
 * boolean across `await` boundaries.  The underlying value genuinely
 * changes at runtime when another async path sets it, so the guard must
 * be re-evaluated after every `await`.
 */
export interface ExitGuard {
  isExited(): boolean;
  markExited(): void;
}

export function createExitGuard(): ExitGuard {
  let exited = false;
  return {
    isExited() {
      return exited;
    },
    markExited() {
      exited = true;
    },
  };
}
