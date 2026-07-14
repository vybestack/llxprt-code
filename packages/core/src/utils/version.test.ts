/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import { getCoreVersion } from './version.js';
import * as packageModule from './package.js';

describe('getCoreVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the version from package.json', async () => {
    vi.spyOn(packageModule, 'getPackageJson').mockResolvedValue({
      name: '@vybestack/llxprt-code-core',
      version: '1.2.3',
    } as packageModule.PackageJson);

    const version = await getCoreVersion();
    expect(version).toBe('1.2.3');
  });

  it('should fall back to "unknown" when package.json is undefined', async () => {
    vi.spyOn(packageModule, 'getPackageJson').mockResolvedValue(undefined);

    const version = await getCoreVersion();
    expect(version).toBe('unknown');
  });

  it('should fall back to "unknown" when version field is missing', async () => {
    vi.spyOn(packageModule, 'getPackageJson').mockResolvedValue({
      name: '@vybestack/llxprt-code-core',
    } as packageModule.PackageJson);

    const version = await getCoreVersion();
    expect(version).toBe('unknown');
  });
});
