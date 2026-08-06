/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  restoreEnv,
  setEnv,
} from '../../packages/test-utils/src/env-test-helpers.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// The helper evaluates process.env['LLXPRT_COVERAGE'] exactly once at
// module-evaluation time. Bun cannot reset its module graph in-process, so the
// ESM cache is bypassed via a cache-busted require() to get a fresh module
// evaluation for each scenario.
const nodeRequire = createRequire(import.meta.url);
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
   * Bun cannot reset its module graph in-process, so the require() cache is
   * busted and sync require() re-evaluates the module on the spot.
   */
  function loadHelper(): { isCoverageEnabled: boolean } {
    delete nodeRequire.cache[helperPath];
    return nodeRequire(helperPath) as { isCoverageEnabled: boolean };
  }

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
    const mod = loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });

  it('returns false when LLXPRT_COVERAGE === "false"', async () => {
    setEnv('LLXPRT_COVERAGE', 'false');
    const mod = loadHelper();
    expect(mod.isCoverageEnabled).toBe(false);
  });

  it('returns true when LLXPRT_COVERAGE === "true"', async () => {
    setEnv('LLXPRT_COVERAGE', 'true');
    const mod = loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });

  it('returns true for any value other than "false"', async () => {
    setEnv('LLXPRT_COVERAGE', '1');
    const mod = loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });
});
