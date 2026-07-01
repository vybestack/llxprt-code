/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260630-ISSUE2300
 * Validate that a runtime id is a non-empty, non-whitespace string.
 *
 * The runtimeId is the sole key for identity resolution; rejecting invalid
 * ids at composition boundaries keeps resolution deterministic and surfaces
 * caller bugs as clear errors instead of silent registry corruption.
 */
export function validateRuntimeId(runtimeId: unknown): void {
  if (
    typeof runtimeId !== 'string' ||
    runtimeId.length === 0 ||
    runtimeId.trim() === ''
  ) {
    throw new Error(
      `[cli-runtime] Invalid runtimeId: expected a non-empty string but received ${
        typeof runtimeId === 'string'
          ? JSON.stringify(runtimeId)
          : String(runtimeId)
      }.`,
    );
  }
}
