/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Durable settings mutation (REQ-021). Wraps the real
 * `SettingsService.updateSettings(changes)` and reads the resulting persisted
 * state back via per-key `get(...)` so mutate→read round-trips. No live `Agent`
 * instance required.
 */

import type { MutateSettingsInput, MutateSettingsResult } from './types.js';

/**
 * Apply a typed change set to the shared settings service and return the
 * resulting persisted values for those keys.
 */
export async function mutateSettings(
  input: MutateSettingsInput,
): Promise<MutateSettingsResult> {
  await input.settingsService.updateSettings({ ...input.changes });

  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(input.changes)) {
    settings[key] = input.settingsService.get(key);
  }

  return { settings };
}
