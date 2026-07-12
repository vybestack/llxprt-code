/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { getPackageJson } from './package.js';
import type { readPackageUp } from 'read-package-up';

function packageReader(
  result: Awaited<ReturnType<typeof readPackageUp>>,
): typeof readPackageUp {
  return vi.fn().mockResolvedValue(result);
}

describe('getPackageJson', () => {
  it('should return packageJson when found', async () => {
    const expectedPackageJsonResult = { name: 'test-pkg', version: '1.2.3' };
    const readPackage = packageReader({
      packageJson: expectedPackageJsonResult,
      path: '/path/to/package.json',
    });

    const result = await getPackageJson('/some/path', readPackage);
    expect(result).toStrictEqual(expectedPackageJsonResult);
    expect(readPackage).toHaveBeenCalledWith({
      cwd: '/some/path',
      normalize: false,
    });
  });

  it.each([
    {
      description: 'no package.json is found',
      readPackage: packageReader(undefined),
      expected: undefined,
    },
    {
      description: 'non-semver versions (when normalize is false)',
      readPackage: packageReader({
        packageJson: { name: 'test-pkg', version: '2024.60' },
        path: '/path/to/package.json',
      }),
      expected: { name: 'test-pkg', version: '2024.60' },
    },
    {
      description: 'readPackageUp throws',
      readPackage: vi.fn().mockRejectedValue(new Error('Read error')),
      expected: undefined,
    },
  ])('should handle $description', async ({ readPackage, expected }) => {
    const result = await getPackageJson('/some/path', readPackage);
    expect(result).toStrictEqual(expected);
  });
});
