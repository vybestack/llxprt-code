/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural mirror of the `SettingsService` members consumed by tools.
 *
 * The owning type is `SettingsService` in @vybestack/llxprt-code-settings.
 * This package does not depend on that package, so the narrow structural
 * subset is declared exactly once here; keep member signatures identical to
 * the owner (#2534 Domain D).
 */
export interface SettingsServiceBoundary {
  /** Get a setting value by key. */
  get(key: string): unknown;
  /** Set a setting value by key. */
  set(key: string, value: unknown): void;
  /** Get all global settings. */
  getAllGlobalSettings(): Record<string, unknown>;
}
