/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Advisory type checks for values a profile carries (issue #2896).
 *
 * The model config dialog once wrote `"top_p": ".95"` — a string where every
 * OpenAI-compatible provider expects a number — and OpenRouter answered
 * `400 top_p: Invalid input: expected number, received string`. Loading such a
 * profile gave no hint that the profile itself was the problem.
 *
 * Deliberately NOT a gate:
 *  - Unknown keys never warn. llxprt cannot know every parameter every model
 *    or custom endpoint accepts, so an unrecognized key is assumed intentional.
 *  - Nothing is dropped, changed, or refused here. The profile still applies
 *    exactly as written; this only reports.
 *
 * Only a key the registry already describes, whose value cannot be reconciled
 * with the type the registry declares, produces a warning — in practice the
 * universally numeric sampling parameters. `normalizeSetting` is applied first
 * so a repairable value (`".95"` -> `0.95`) stays silent; the warning is
 * reserved for values that really would go out malformed.
 */

import {
  normalizeSetting,
  validateSetting,
} from '@vybestack/llxprt-code-settings/settings/settingsRegistry.js';

/** A single advisory finding about one profile value. */
export interface ProfileValueWarning {
  readonly key: string;
  readonly message: string;
}

function checkSection(
  section: Record<string, unknown>,
  found: ProfileValueWarning[],
): void {
  for (const [key, value] of Object.entries(section)) {
    if (value === undefined || value === null) {
      continue;
    }
    const result = validateSetting(key, normalizeSetting(key, value));
    if (!result.success) {
      found.push({
        key,
        message: result.message ?? `invalid value for '${key}'`,
      });
    }
  }
}

/**
 * Collect advisory warnings for a profile's model params and ephemerals.
 * Returns an empty array when everything type-checks or is unrecognized.
 */
export function collectProfileValueWarnings(
  modelParams: Record<string, unknown>,
  ephemeralSettings: Record<string, unknown>,
): ProfileValueWarning[] {
  const found: ProfileValueWarning[] = [];
  checkSection(modelParams, found);
  checkSection(ephemeralSettings, found);
  return found;
}

/**
 * Render the warnings as user-facing lines naming the profile, so the message
 * points at the file to edit rather than at the provider's rejection.
 */
export function formatProfileValueWarnings(
  profileName: string,
  warnings: readonly ProfileValueWarning[],
): string[] {
  return warnings.map(
    (w) =>
      `Profile '${profileName}': ${w.message}. The value is being used as written and the provider may reject it.`,
  );
}
