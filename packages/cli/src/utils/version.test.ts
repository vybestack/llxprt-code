/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { getCliVersion, __resetVersionCacheForTesting } from './version.js';
import { getPackageJson } from '@vybestack/llxprt-code-core';

const originalCliVersion = process.env.CLI_VERSION;

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actual,
    getPackageJson: vi.fn(),
  };
});

const mockGetPackageJson = getPackageJson as Mock<typeof getPackageJson>;

describe('getCliVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLI_VERSION;
  });

  afterEach(() => {
    if (originalCliVersion === undefined) {
      delete process.env.CLI_VERSION;
      return;
    }

    process.env.CLI_VERSION = originalCliVersion;
  });

  it('should return env version when CLI_VERSION is set', async () => {
    process.env.CLI_VERSION = '1.2.3-env';
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-pkg' } as never);

    const result = await getCliVersion();

    expect(result).toBe('1.2.3-env');
    expect(mockGetPackageJson).not.toHaveBeenCalled();
  });

  it('should read package version on first call and cache it for subsequent calls', async () => {
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-pkg' } as never);

    const result1 = await getCliVersion();
    expect(result1).toBe('1.0.0-pkg');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);

    // Modify what getPackageJson would return if called again
    mockGetPackageJson.mockResolvedValue({ version: '2.0.0-pkg' } as never);

    const result2 = await getCliVersion();
    expect(result2).toBe('1.0.0-pkg'); // Still returns cached value
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1); // Not called again
  });

  it('should cache unknown when no version info available and not re-read', async () => {
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockResolvedValue({} as never);

    const result1 = await getCliVersion();
    expect(result1).toBe('unknown');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);

    // Modify what getPackageJson would return if called again
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-late' } as never);

    const result2 = await getCliVersion();
    expect(result2).toBe('unknown'); // Still returns cached 'unknown'
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1); // Not called again
  });

  it('should cache unknown when getPackageJson throws', async () => {
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockRejectedValue(new Error('ENOENT'));

    const result = await getCliVersion();
    expect(result).toBe('unknown');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should return same cached value across multiple calls in same process', async () => {
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockResolvedValue({ version: '3.0.0-stable' } as never);

    const results = await Promise.all([
      getCliVersion(),
      getCliVersion(),
      getCliVersion(),
    ]);

    expect(results).toStrictEqual([
      '3.0.0-stable',
      '3.0.0-stable',
      '3.0.0-stable',
    ]);
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should reset cache when module is re-imported (deterministic test reset)', async () => {
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-first' } as never);

    const result1 = await getCliVersion();
    expect(result1).toBe('1.0.0-first');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);

    // Simulate fresh test module environment by resetting the cache seam and re-mocking
    mockGetPackageJson.mockClear();
    mockGetPackageJson.mockResolvedValue({ version: '2.0.0-second' } as never);
    __resetVersionCacheForTesting();

    const result2 = await getCliVersion();
    expect(result2).toBe('2.0.0-second');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should not use env version set after module import (startup-stable semantics)', async () => {
    // Ensure env is NOT set at import time
    delete process.env.CLI_VERSION;
    __resetVersionCacheForTesting();
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-pkg' } as never);

    // Set env AFTER import but BEFORE first call
    process.env.CLI_VERSION = '99.99.99-env';

    // Should use package.json version, not the env set after import
    const result = await getCliVersion();
    expect(result).toBe('1.0.0-pkg');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should use env value at import time even if env changes before first call', async () => {
    // Set env at import time
    process.env.CLI_VERSION = '1.2.3-initial';
    __resetVersionCacheForTesting();

    // Change env BEFORE first call
    process.env.CLI_VERSION = '99.99.99-later';

    // Should use the env value from import time, not the current env
    const result = await getCliVersion();
    expect(result).toBe('1.2.3-initial');
    // Should not even call getPackageJson since env was set at import
    expect(mockGetPackageJson).not.toHaveBeenCalled();
  });
});
