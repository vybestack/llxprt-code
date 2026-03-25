/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P06
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP-005
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 *
 * Stateless hardening preference configuration and querying.
 * This module manages the global CLI stateless guard preference.
 */

import { getCurrentRuntimeScope } from './runtimeContextFactory.js';
import {
  runtimeRegistry,
  resolveActiveRuntimeIdentity,
} from './runtimeRegistry.js';

const STATELESS_METADATA_KEYS = [
  'statelessHardening',
  'statelessProviderMode',
  'statelessGuards',
  'statelessMode',
] as const;

export type StatelessHardeningPreference = 'legacy' | 'strict';

let statelessHardeningPreferenceOverride: StatelessHardeningPreference | null =
  null;

function normalizeStatelessPreference(
  value: unknown,
): StatelessHardeningPreference | null {
  if (typeof value === 'boolean') {
    return value ? 'strict' : 'legacy';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'strict' ||
      normalized === 'enabled' ||
      normalized === 'true' ||
      normalized === 'on'
    ) {
      return 'strict';
    }
    if (
      normalized === 'legacy' ||
      normalized === 'disabled' ||
      normalized === 'false' ||
      normalized === 'off'
    ) {
      return 'legacy';
    }
  }
  return null;
}

function readStatelessPreferenceFromMetadata(
  metadata: Record<string, unknown> | undefined,
): StatelessHardeningPreference | null {
  if (!metadata) {
    return null;
  }
  for (const key of STATELESS_METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      const value = metadata[key];
      const preference = normalizeStatelessPreference(value);
      if (preference) {
        return preference;
      }
    }
  }
  return null;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 */
export function resolveStatelessHardeningPreference(): StatelessHardeningPreference {
  const scope = getCurrentRuntimeScope();
  const scopePreference = readStatelessPreferenceFromMetadata(scope?.metadata);
  if (scopePreference) {
    return scopePreference;
  }

  const { runtimeId } = resolveActiveRuntimeIdentity();
  const entry = runtimeRegistry.get(runtimeId);
  const entryPreference = readStatelessPreferenceFromMetadata(entry?.metadata);
  if (entryPreference) {
    return entryPreference;
  }

  if (statelessHardeningPreferenceOverride) {
    return statelessHardeningPreferenceOverride;
  }

  return 'strict';
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Configure the global CLI stateless guard preference. Tests and CLI bootstrap
 * can call this to opt into strict guards without environment toggles.
 */
export function configureCliStatelessHardening(
  preference: StatelessHardeningPreference | null,
): void {
  statelessHardeningPreferenceOverride = preference;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 */
export function getCliStatelessHardeningOverride(): StatelessHardeningPreference | null {
  return statelessHardeningPreferenceOverride;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Reports the currently resolved stateless hardening preference.
 */
export function getCliStatelessHardeningPreference(): StatelessHardeningPreference {
  return resolveStatelessHardeningPreference();
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Check if stateless provider integration is enabled.
 * Exported for use by other modules that need to check the stateless mode.
 */
export function isStatelessProviderIntegrationEnabled(): boolean {
  return resolveStatelessHardeningPreference() === 'strict';
}

export function isCliStatelessProviderModeEnabled(): boolean {
  return isStatelessProviderIntegrationEnabled();
}
