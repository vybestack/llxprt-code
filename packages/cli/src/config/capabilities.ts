/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow capability interfaces over core's `Config`.
 *
 * Each names the members one use case reads, so a consumer depends on one to
 * three members rather than the ~349 the compiler reports on `Config`. Core's
 * `Config` satisfies each structurally, so composition roots keep passing it
 * and nothing moves at runtime.
 *
 * Not exported from the package root: these are consumer-owned use-case
 * contracts. Publishing them would rebuild a god-object out of whatever the
 * package collectively needs. Add an interface per use case rather than
 * widening one to fit an unrelated caller.
 *
 * Part of the #2615 Config decomposition.
 */

import type { Storage } from '@vybestack/llxprt-code-storage';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';

/** Reads whether debug output is enabled. */
export interface DebugModeSource {
  getDebugMode(): boolean;
}

/** Reaches the profile manager. */
export interface ProfileManagerSource {
  getProfileManager(): ProfileManager | undefined;
}

/** Reaches session storage. */
export interface StorageSource {
  readonly storage: Storage;
}

/** Reads and writes ephemeral (session-scoped) settings. */
export interface EphemeralSettingsAccess {
  getEphemeralSetting(key: string): unknown;
  setEphemeralSetting(key: string, value: unknown): void;
}
