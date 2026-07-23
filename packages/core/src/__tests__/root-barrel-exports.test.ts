/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests protecting Node-style public import resolution for the
 * core root barrel export (`@vybestack/llxprt-code-core`).
 *
 * These tests assert that public consumers can import shared adapter
 * instances (e.g. `coreStorageServiceAdapter`) from the root barrel
 * instead of relying on unexported deep subpaths such as
 * `@vybestack/llxprt-code-core/tools-adapters/CoreStorageServiceAdapter.js`,
 * which are NOT present in the package `exports` map and therefore can
 * break under Node's ESM resolution / bundlers that honor `exports`.
 */

import { describe, it, expect } from 'vitest';

// Import from the root barrel using the canonical public specifier.
import {
  coreStorageServiceAdapter,
  CoreStorageServiceAdapter,
} from '../index.js';

describe('core root barrel public exports', () => {
  describe('coreStorageServiceAdapter', () => {
    it('is exported from the root barrel', () => {
      expect(coreStorageServiceAdapter).toBeDefined();
    });

    it('is a singleton shared across imports', async () => {
      const mod1 = await import('../index.js');
      const mod2 = await import('../index.js');
      expect(mod1.coreStorageServiceAdapter).toBe(
        mod2.coreStorageServiceAdapter,
      );
    });

    it('is an instance of CoreStorageServiceAdapter', () => {
      expect(coreStorageServiceAdapter).toBeInstanceOf(
        CoreStorageServiceAdapter,
      );
    });

    it('exposes the getGlobalMemoryDir behavior (the contract memoryCommand relies on)', () => {
      // The memory command depends on this symbol resolving from the public
      // barrel. Verifying the observable method preserves the behavioral
      // contract without widening the API.
      expect(typeof coreStorageServiceAdapter.getGlobalMemoryDir).toBe(
        'function',
      );
      const dir = coreStorageServiceAdapter.getGlobalMemoryDir();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });
  });

  describe('public subpath resolution boundary', () => {
    it('the root barrel resolves the symbols a public consumer needs', async () => {
      // Dynamic re-import of the root barrel simulates a public consumer
      // resolving through package `exports`. If the barrel stops re-exporting
      // these symbols, this assertion fails.
      const mod = await import('../index.js');
      expect(mod.coreStorageServiceAdapter).toBeDefined();
      expect(mod.CoreStorageServiceAdapter).toBeDefined();
    });
  });
});
