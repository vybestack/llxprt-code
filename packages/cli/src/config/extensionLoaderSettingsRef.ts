/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadSettings } from './settings.js';

/**
 * Indirection for the `loadSettings` reference used by the extension loader.
 *
 * Bun's `mock.module` patches a module namespace, but a binding that was
 * destructured at module scope before the patch is applied keeps pointing at
 * the original function. `extension.ts` captures `loadSettings` when it builds
 * its loader dependencies, so a test that mocks `./settings.js` afterwards
 * would not be seen. Resolving through this accessor at call time lets a test
 * inject its own implementation.
 */
let loadSettingsRef: typeof loadSettings = loadSettings;

export function getLoadSettings(): typeof loadSettings {
  return loadSettingsRef;
}

/** Overrides the loader's `loadSettings`; pass `null` to restore the real one. */
export function __setLoadSettingsForTesting(
  fn: typeof loadSettings | null,
): void {
  loadSettingsRef = fn ?? loadSettings;
}
