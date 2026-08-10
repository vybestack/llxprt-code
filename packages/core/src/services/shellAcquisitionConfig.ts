/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createByteBudget,
  resolveByteBudgetFromSetting,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
  type ByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';

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
  if (outputRetentionMaxBytes === undefined) {
    return createByteBudget(DEFAULT_ACQUISITION_BUDGET_BYTES);
  }
  return resolveByteBudgetFromSetting(outputRetentionMaxBytes);
}
