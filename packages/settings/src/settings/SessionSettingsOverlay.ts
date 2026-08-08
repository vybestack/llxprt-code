/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertSessionScopedKey } from './settingsRegistry.js';

/**
 * A dedicated, session-scoped key-value store for settings that must persist
 * across profile application and be shared by reference between a foreground
 * {@link SettingsService} and its isolated child instances (subagents).
 *
 * Unlike the profile-local global map, this overlay is **not** cleared or
 * repopulated when a profile is loaded. It holds explicit session overrides
 * (e.g. `/dumpcontext on`) that take precedence over any profile-local value.
 *
 * Foreground and child services share the same overlay instance by reference;
 * a brand-new session gets a fresh overlay. Every mutating or reading method
 * funnels through {@link assertSessionScopedKey}, which canonicalises the key
 * and rejects any key that is not a registry-classified session-scoped setting.
 * This guarantees the overlay can never hold an arbitrary key (e.g.
 * `auth-key`, `model`, `endpoint`) that would leak into child snapshots.
 *
 * The overlay is an internal implementation detail and is intentionally NOT
 * exported from the public package barrel.
 */
export class SessionSettingsOverlay {
  private readonly values = new Map<string, unknown>();

  has(key: string): boolean {
    return this.values.has(assertSessionScopedKey(key));
  }

  get(key: string): unknown {
    return this.values.get(assertSessionScopedKey(key));
  }

  set(key: string, value: unknown): void {
    this.values.set(assertSessionScopedKey(key), value);
  }

  delete(key: string): void {
    this.values.delete(assertSessionScopedKey(key));
  }

  /**
   * Returns a shallow copy of all session-scoped overrides as a plain object.
   * The returned object is detached from the overlay so callers can safely
   * freeze or mutate it without affecting live state.
   */
  toObject(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.values) {
      result[key] = value;
    }
    return result;
  }
}
