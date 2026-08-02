/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model-parameter commit logic for the model config dialog.
 *
 * Extracted from `ModelConfigDialog.tsx` so the typing contract can be
 * exercised directly: full-render Ink component tests under
 * `src/ui/components/` are excluded from this package's vitest routing
 * (see `vitest.test-groups.ts`), so behavior asserted only through the
 * rendered dialog would never run in CI.
 *
 * Contract (issue #2896): a field whose registry spec declares
 * `type: 'number'` must be written to the runtime as a finite `number`.
 * A value that does not parse to a finite number is rejected with a
 * validation message instead of being written as a raw string — that is how
 * `"top_p": ".95"` reached a profile and produced
 * `top_p: Invalid input: expected number, received string` from OpenRouter.
 */

import { getSettingSpec } from '@vybestack/llxprt-code-settings';
import { parseValue } from '../commands/setCommand.js';

/**
 * Discriminated so a caller cannot read `message` without first narrowing on
 * the failure branch, and so the failure branch always carries one.
 */
export type CommitResult =
  | { success: true }
  | { success: false; message: string };

export const NOT_A_NUMBER_MESSAGE = 'must be a number';

/**
 * Parse `raw` for the model parameter `key` and hand the typed value to
 * `setActiveModelParam`.
 *
 * Returns `{ success: false }` when the registry declares the parameter
 * numeric and the input does not parse to a finite number, or when the
 * runtime write throws (e.g. no active provider).
 */
export function commitModelParam(
  key: string,
  raw: string,
  setActiveModelParam: (value: unknown) => void,
): CommitResult {
  // Parsing stays inside the guarded region, as it was before this logic was
  // extracted from the dialog: an escaping throw would tear down the Ink UI
  // instead of surfacing as the inline validation message.
  try {
    const parsed = parseValue(raw);
    if (requiresNumber(key) && !isFiniteNumber(parsed)) {
      return { success: false, message: NOT_A_NUMBER_MESSAGE };
    }
    setActiveModelParam(parsed);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

function requiresNumber(key: string): boolean {
  return getSettingSpec(key)?.type === 'number';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
