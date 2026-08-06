/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  restoreEnv,
  setEnv,
} from '../../packages/test-utils/src/env-test-helpers.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// The helper evaluates process.env['LLXPRT_COVERAGE'] exactly once at
// module-evaluation time. Vitest supports vi.resetModules() to clear the
// module registry and force a fresh evaluation per test. Bun cannot reset
// its module graph in-process, so under Bun we bypass the ESM cache via a
// cache-busted require() to get a fresh module evaluation for each scenario.
const isBun = typeof Bun !== 'undefined';
const nodeRequire = createRequire(import.meta.url);
// Bun resolves .ts via require(); Node/Vitest need the explicit .ts path.
const helperPath = resolve(
  import.meta.dirname,
  '..',
  '..',
  'vitest.coverage.ts',
);

describe('isCoverageEnabled', () => {
  // Snapshot the original env state so the "unset" test (which performs a real
  // deletion to verify genuine unset semantics) cannot leak into sibling test
  // files in the same worker. restoreEnv only reverts setEnv mutations, not a
  // key deleted directly off process.env.
  const originalValue = process.env['LLXPRT_COVERAGE'];
  const hadKey = Object.prototype.hasOwnProperty.call(
    process.env,
    'LLXPRT_COVERAGE',
  );

  /**
   * Loads a fresh module instance so the module-level const (which reads
   * process.env at evaluation time) is re-evaluated against the current env.
   *
   * Under Vitest, vi.resetModules() clears the ESM registry and dynamic
   * import() re-evaluates the module. Under Bun, vi.resetModules() is
   * unsupported, so we bust the require() cache and use sync require() which
   * re-evaluates the module on the spot.
   */
  async function loadHelper(): Promise<{ isCoverageEnabled: boolean }> {
    if (isBun) {
      delete nodeRequire.cache[helperPath];
      return nodeRequire(helperPath) as { isCoverageEnabled: boolean };
    }
    // Vitest: vi.resetModules() in beforeEach clears the ESM cache.
    return (await import('../../vitest.coverage.js')) as {
      isCoverageEnabled: boolean;
    };
  }

  beforeEach(() => {
    if (!isBun) {
      vi.resetModules();
    }
  });

  afterEach(() => {
    restoreEnv();
    if (hadKey) {
      process.env['LLXPRT_COVERAGE'] = originalValue;
    } else {
      delete process.env['LLXPRT_COVERAGE'];
    }
  });

  it('defaults to enabled (true) when LLXPRT_COVERAGE is unset', async () => {
    delete process.env['LLXPRT_COVERAGE'];
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });

  it('returns false when LLXPRT_COVERAGE === "false"', async () => {
    setEnv('LLXPRT_COVERAGE', 'false');
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(false);
  });

  it('returns true when LLXPRT_COVERAGE === "true"', async () => {
    setEnv('LLXPRT_COVERAGE', 'true');
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });

  it('returns true for any value other than "false"', async () => {
    setEnv('LLXPRT_COVERAGE', '1');
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });
});
