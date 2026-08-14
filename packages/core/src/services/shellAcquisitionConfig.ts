/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createByteBudget,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
  ACQUISITION_HARD_MAX_BYTES,
  normalizeHardMax,
  type ByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';

/**
 * Resolve a raw settings value (from ephemeral settings / profile) into a
 * validated {@link ByteBudget}. Falls back to the default when the value is
 * absent, invalid, or disabled.
 *
 * This function owns the settings-policy interpretation (-1 meaning the
 * hard max, invalid strings meaning default, disabled values meaning
 * default) so the shared acquisition layer never needs to interpret raw
 * configuration.
 */
export function resolveAcquisitionBudgetFromSetting(
  rawValue: unknown,
  hardMax: number = ACQUISITION_HARD_MAX_BYTES,
): ByteBudget {
  const effectiveHardMax = normalizeHardMax(hardMax);
  if (rawValue === undefined || rawValue === null) {
    return createByteBudget(DEFAULT_ACQUISITION_BUDGET_BYTES, effectiveHardMax);
  }

  const numeric = typeof rawValue === 'string' ? Number(rawValue) : rawValue;

  // A configured -1 means "largest permitted value", never unbounded.
  if (numeric === -1) {
    return createByteBudget(effectiveHardMax, effectiveHardMax);
  }

  if (
    typeof numeric !== 'number' ||
    !Number.isFinite(numeric) ||
    numeric <= 0
  ) {
    return createByteBudget(DEFAULT_ACQUISITION_BUDGET_BYTES, effectiveHardMax);
  }

  return createByteBudget(numeric, effectiveHardMax);
}

/**
 * Resolve the shell output retention byte budget from the execution config.
 *
 * The budget is always finite: absent or invalid values use
 * {@link DEFAULT_ACQUISITION_BUDGET_BYTES}, while -1 selects the finite hard
 * maximum and never means "unbounded".
 */
export function resolveShellRetentionBudget(
  outputRetentionMaxBytes: number | undefined,
): ByteBudget {
  return resolveAcquisitionBudgetFromSetting(outputRetentionMaxBytes);
}
