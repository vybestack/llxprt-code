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
 * Under Vitest: mock factories can be async, so `importActualSync` is only
 * reached if a sync factory calls it. If `vi.importActualSync` is not defined,
 * this throws a clear error directing the caller to use the async pattern.
 */
export function importActualSync<T>(id: string): T {
  const viWithSync = vi as unknown as {
    importActualSync?: (modulePath: string) => T;
  };
  if (typeof viWithSync.importActualSync === 'function') {
    return viWithSync.importActualSync(id);
  }
  throw new Error(
    `importActualSync('${id}') requires Bun (vi.importActualSync is not available under Vitest). ` +
      'Use "await vi.importActual(id)" inside an async mock factory instead.',
  );
}
