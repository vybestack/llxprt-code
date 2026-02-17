/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
 * @requirement:HOOK-005,HOOK-148
 * @pseudocode:analysis/pseudocode/01-hook-system-lifecycle.md
 *
 * Error thrown when attempting to use HookSystem before initialization
 */
export class HookSystemNotInitializedError extends Error {
  constructor(
    message = 'HookSystem not initialized. Call initialize() before using getEventHandler() or getRegistry().',
  ) {
    super(message);
    this.name = 'HookSystemNotInitializedError';
  }
}
