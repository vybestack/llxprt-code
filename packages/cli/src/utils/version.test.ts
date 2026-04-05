/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPackageJson } from '@vybestack/llxprt-code-core';

const originalCliVersion = process.env.CLI_VERSION;

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    getPackageJson: vi.fn(),
  };
});

const mockGetPackageJson = vi.mocked(getPackageJson);

describe('getCliVersion', () => {
  beforeEach(() => {
    vi.resetModules();
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
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-pkg' } as never);

    const { getCliVersion } = await import('./version.js');
    const result = await getCliVersion();

    expect(result).toBe('1.2.3-env');
    expect(mockGetPackageJson).not.toHaveBeenCalled();
  });

  it('should read package version on first call and cache it for subsequent calls', async () => {
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-pkg' } as never);

    const { getCliVersion } = await import('./version.js');

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
    mockGetPackageJson.mockResolvedValue({} as never);

    const { getCliVersion } = await import('./version.js');

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
    mockGetPackageJson.mockRejectedValue(new Error('ENOENT'));

    const { getCliVersion } = await import('./version.js');

    const result = await getCliVersion();
    expect(result).toBe('unknown');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should return same cached value across multiple calls in same process', async () => {
    mockGetPackageJson.mockResolvedValue({ version: '3.0.0-stable' } as never);

    const { getCliVersion } = await import('./version.js');

    const results = await Promise.all([
      getCliVersion(),
      getCliVersion(),
      getCliVersion(),
    ]);

    expect(results).toEqual(['3.0.0-stable', '3.0.0-stable', '3.0.0-stable']);
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should reset cache when module is re-imported (deterministic test reset)', async () => {
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-first' } as never);

    const { getCliVersion: getCliVersion1 } = await import('./version.js');
    const result1 = await getCliVersion1();
    expect(result1).toBe('1.0.0-first');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);

    // Simulate fresh test module environment by resetting Vitest's module registry and re-mocking
    vi.resetModules();
    mockGetPackageJson.mockClear();
    mockGetPackageJson.mockResolvedValue({ version: '2.0.0-second' } as never);

    const { getCliVersion: getCliVersion2 } = await import('./version.js');
    const result2 = await getCliVersion2();
    expect(result2).toBe('2.0.0-second');
    expect(mockGetPackageJson).toHaveBeenCalledTimes(1);
  });

  it('should not use env version set after module import (startup-stable semantics)', async () => {
    // Ensure env is NOT set at import time
    delete process.env.CLI_VERSION;
    mockGetPackageJson.mockResolvedValue({ version: '1.0.0-pkg' } as never);

    // Import module with env absent
    const { getCliVersion } = await import('./version.js');

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

    // Import module with env set
    const { getCliVersion } = await import('./version.js');

    // Change env BEFORE first call
    process.env.CLI_VERSION = '99.99.99-later';

    // Should use the env value from import time, not the current env
    const result = await getCliVersion();
    expect(result).toBe('1.2.3-initial');
    // Should not even call getPackageJson since env was set at import
    expect(mockGetPackageJson).not.toHaveBeenCalled();
  });
});
