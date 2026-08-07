/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile-auth-ephemeral snapshot helpers, mirrored from the CLI's
 * `config/profileAuthEphemerals.ts` so the agents package can preserve
 * profile-loaded auth ephemerals across a provider switch WITHOUT importing
 * from packages/cli (#2374, part of #1595).
 *
 * The snapshot/reapply cycle is the mechanism that keeps profile auth
 * (auth-key / auth-keyfile / base-url) intact when switchActiveProvider clears
 * ephemerals — preserving the issue #2364 fix inside agent construction.
 */

import type { EphemeralSettingsAccess } from '../config/capabilities.js';

const PROFILE_AUTH_EPHEMERAL_KEYS = [
  'auth-key',
  'auth-keyfile',
  'auth-key-name',
  'base-url',
] as const;

export type ProfileAuthEphemeralSnapshot = Partial<
  Record<(typeof PROFILE_AUTH_EPHEMERAL_KEYS)[number], unknown>
>;

function isPresentEphemeral(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value != null;
}

export function snapshotProfileAuthEphemerals(
  config: EphemeralSettingsAccess,
): ProfileAuthEphemeralSnapshot {
  const snapshot: ProfileAuthEphemeralSnapshot = {};
  for (const key of PROFILE_AUTH_EPHEMERAL_KEYS) {
    const value = config.getEphemeralSetting(key);
    if (isPresentEphemeral(value)) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

export function hasProfileAuthEphemerals(
  snapshot: ProfileAuthEphemeralSnapshot,
): boolean {
  return Object.keys(snapshot).length > 0;
}

export function reapplyProfileAuthEphemerals(
  config: EphemeralSettingsAccess,
  snapshot: ProfileAuthEphemeralSnapshot,
): void {
  for (const key of PROFILE_AUTH_EPHEMERAL_KEYS) {
    if (key in snapshot) {
      config.setEphemeralSetting(key, snapshot[key]);
    }
  }
}
