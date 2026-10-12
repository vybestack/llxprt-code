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
 * Stateless hardening preference resolution from owner metadata.
 */

const STATELESS_METADATA_KEYS = [
  'statelessHardening',
  'statelessProviderMode',
  'statelessGuards',
  'statelessMode',
] as const;

export type StatelessHardeningPreference = 'legacy' | 'strict';

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
export function resolveStatelessHardeningPreference(
  metadata: Record<string, unknown>,
): StatelessHardeningPreference {
  const preference = readStatelessPreferenceFromMetadata(metadata);
  if (preference === null) {
    throw new Error('statelessHardening preference requires owner metadata');
  }
  return preference;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Reports the currently resolved stateless hardening preference.
 */
export function getCliStatelessHardeningPreference(
  metadata: Record<string, unknown>,
): StatelessHardeningPreference {
  return resolveStatelessHardeningPreference(metadata);
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement:REQ-SP4-005
 * Check if stateless provider integration is enabled.
 * Exported for use by other modules that need to check the stateless mode.
 */
export function isStatelessProviderIntegrationEnabled(
  metadata: Record<string, unknown>,
): boolean {
  return resolveStatelessHardeningPreference(metadata) === 'strict';
}

export function isCliStatelessProviderModeEnabled(
  metadata: Record<string, unknown>,
): boolean {
  return isStatelessProviderIntegrationEnabled(metadata);
}
