/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Atomic snapshot/rollback wrapper for profile application (#2534 C5).
 * Extracted verbatim from profileApplication.ts (pure relocation, behavior
 * unchanged) so that module stays within the max-lines lint budget.
 */

import type { Profile } from '@vybestack/llxprt-code-settings';
import { getCliRuntimeServices } from './runtimeSettings.js';
import {
  applyProfileCascade,
  type ProfileApplicationOptions,
  type ProfileApplicationResult,
} from './profileApplication.js';

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P09
 * @requirement REQ-SP3-002
 * @pseudocode profile-application.md lines 1-22
 */
export async function applyProfileWithGuards(
  profileInput: Profile,
  options: ProfileApplicationOptions = {},
): Promise<ProfileApplicationResult> {
  // One runtime-services resolution shared by wrapper and cascade.
  const runtimeServices = getCliRuntimeServices();
  // Atomic profile application (#2534 C5): snapshot the persisted settings
  // surface before the cascade; on failure restore it and rethrow the
  // ORIGINAL error. Not rolled back: ProviderManager runtime caches (they
  // are caches over this store and refresh on next access).
  const stateSnapshot =
    runtimeServices.settingsService.exportForStateSnapshot();
  try {
    return await applyProfileCascade(profileInput, options, runtimeServices);
  } catch (error) {
    runtimeServices.settingsService.restoreFromStateSnapshot(stateSnapshot);
    throw error;
  }
}
