/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the readEnvMs timeout-override helper in the Windows
 * installed-command smoke constants. readEnvMs must accept only positive
 * integer millisecond values and fall back to the default for anything else
 * (missing, non-numeric, zero/negative, or fractional/sub-unit values).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

const { readEnvMs } = require(
  join(repoRoot, 'scripts', 'windows-installed-command-smoke', 'constants.cjs'),
) as { readEnvMs: (name: string, defaultMs: number) => number };

const ENV_KEY = 'LLXPRT_TEST_READ_ENV_MS';

describe('readEnvMs', () => {
  const originalValue = process.env[ENV_KEY];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
  });

  it('returns a valid positive integer value from the environment', () => {
    process.env[ENV_KEY] = '600000';
    expect(readEnvMs(ENV_KEY, 30_000)).toBe(600_000);
  });

  it('falls back to the default when the value is fractional (sub-unit ms)', () => {
    process.env[ENV_KEY] = '0.5';
    expect(readEnvMs(ENV_KEY, 30_000)).toBe(30_000);
  });

  it('falls back to the default when the value is fractional but above one', () => {
    process.env[ENV_KEY] = '1.5';
    expect(readEnvMs(ENV_KEY, 30_000)).toBe(30_000);
  });

  it('falls back to the default when the value is zero', () => {
    process.env[ENV_KEY] = '0';
    expect(readEnvMs(ENV_KEY, 30_000)).toBe(30_000);
  });

  it('falls back to the default when the value is non-numeric', () => {
    process.env[ENV_KEY] = 'not-a-number';
    expect(readEnvMs(ENV_KEY, 30_000)).toBe(30_000);
  });

  it('falls back to the default when the env var is missing', () => {
    delete process.env[ENV_KEY];
    expect(readEnvMs(ENV_KEY, 42_000)).toBe(42_000);
  });
});
