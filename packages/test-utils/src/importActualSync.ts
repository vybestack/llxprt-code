/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

/**
 * Synchronously loads the actual (un-mocked) module for a specifier.
 *
 * Under Bun: `vi.importActualSync` is provided by the augment-bun-vi.ts
 * preload. Bun's `mock.module` evaluates factories eagerly for already-loaded
 * modules and deadlocks if any `await` is inside the factory body, so mock
 * factories must be synchronous. This helper replaces the common
 * `await vi.importActual(id)` pattern inside `vi.mock` factories.
 *
 * Under Vitest: `vi.importActualSync` is provided by each workspace's
 * test-setup.ts via `createRequire`, which bypasses vi.mock interception.
 */
export function importActualSync<T>(id: string): T {
  return (
    vi as unknown as { importActualSync: (modulePath: string) => T }
  ).importActualSync(id);
}
