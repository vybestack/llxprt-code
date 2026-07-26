/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The helper evaluates process.env['LLXPRT_COVERAGE'] exactly once at
// module-evaluation time, so each test must get a FRESH module instance.
// vi.resetModules() clears the module registry; combined with vi.stubEnv this
// forces a re-evaluation of the const on every dynamic import.
describe('isCoverageEnabled', () => {
  // Snapshot the original env state so the "unset" test (which performs a real
  // deletion to verify genuine unset semantics) cannot leak into sibling test
  // files in the same worker. vi.unstubAllEnvs only restores stubEnv mutations,
  // not a key deleted directly off process.env.
  const originalValue = process.env['LLXPRT_COVERAGE'];
  const hadKey = Object.prototype.hasOwnProperty.call(
    process.env,
    'LLXPRT_COVERAGE',
  );

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (hadKey) {
      process.env['LLXPRT_COVERAGE'] = originalValue;
    } else {
      delete process.env['LLXPRT_COVERAGE'];
    }
  });

  async function loadHelper(): Promise<{ isCoverageEnabled: boolean }> {
    return (await import('../../vitest.coverage.js')) as {
      isCoverageEnabled: boolean;
    };
  }

  it('defaults to enabled (true) when LLXPRT_COVERAGE is unset', async () => {
    delete process.env['LLXPRT_COVERAGE'];
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });

  it('returns false when LLXPRT_COVERAGE === "false"', async () => {
    vi.stubEnv('LLXPRT_COVERAGE', 'false');
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(false);
  });

  it('returns true when LLXPRT_COVERAGE === "true"', async () => {
    vi.stubEnv('LLXPRT_COVERAGE', 'true');
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });

  it('returns true for any value other than "false"', async () => {
    vi.stubEnv('LLXPRT_COVERAGE', '1');
    const mod = await loadHelper();
    expect(mod.isCoverageEnabled).toBe(true);
  });
});
