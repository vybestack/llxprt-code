/**
 * @license
 * Copyright 2025 Google LLC
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
import { getPackageJson } from './package.js';
import { readPackageUp } from 'read-package-up';

void vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(),
}));

describe('getPackageJson', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return packageJson when found', async () => {
    const expectedPackageJsonResult = { name: 'test-pkg', version: '1.2.3' };
    (readPackageUp as Mock<typeof readPackageUp>).mockResolvedValue({
      packageJson: expectedPackageJsonResult,
      path: '/path/to/package.json',
    });

    const result = await getPackageJson('/some/path');
    expect(result).toStrictEqual(expectedPackageJsonResult);
    expect(readPackageUp).toHaveBeenCalledWith({
      cwd: '/some/path',
      normalize: false,
    });
  });

  it.each([
    {
      description: 'no package.json is found',
      setup: () =>
        (readPackageUp as Mock<typeof readPackageUp>).mockResolvedValue(
          undefined,
        ),
      expected: undefined,
    },
    {
      description: 'non-semver versions (when normalize is false)',
      setup: () =>
        (readPackageUp as Mock<typeof readPackageUp>).mockResolvedValue({
          packageJson: { name: 'test-pkg', version: '2024.60' },
          path: '/path/to/package.json',
        }),
      expected: { name: 'test-pkg', version: '2024.60' },
    },
    {
      description: 'readPackageUp throws',
      setup: () =>
        (readPackageUp as Mock<typeof readPackageUp>).mockRejectedValue(
          new Error('Read error'),
        ),
      expected: undefined,
    },
  ])('should handle $description', async ({ setup, expected }) => {
    setup();
    const result = await getPackageJson('/some/path');
    expect(result).toStrictEqual(expected);
  });
});
